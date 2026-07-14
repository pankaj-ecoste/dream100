// The AI research agent: every Claude API call in the app happens HERE.
// This is the ONLY file that imports @anthropic-ai/sdk — the same rule
// lib/zoho.ts enforces for Zoho (plan.md §8: "the app never talks to
// Zoho or Claude directly").
//
// The route handler (app/api/chat/route.ts) owns HTTP concerns — auth,
// validation, the SSE Response. This file owns the model: prompts in,
// AgentEvents out through the `send` callback, usage stats back.
//
// PRODUCTION DEBUG MAP:
//   "research run fails / hangs"      → run* functions here + Vercel logs
//   "wrong CRM data shown to model"   → loadClientContext here
//   "cost numbers look wrong"         → PRICING + estimateCostUsd here
//   "cache_read_tokens stuck at zero" → a *_SYSTEM prompt in lib/prompts.ts
//                                        picked up dynamic content (see the
//                                        layout rule at the top of that file)
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CRUX_SYSTEM,
  buildCruxUser,
  RESEARCH_SYSTEM,
  buildResearchUser,
  ANALYSIS_SYSTEM,
  buildAnalysisUser,
  QA_SYSTEM,
  buildQaContext,
  type ClientContext,
} from "./prompts";
import { enforceSourceLinks } from "./format";

export const MODEL = "claude-sonnet-5";

// Introductory pricing, valid through Aug 2026 (plan.md §6.2) — after
// that, input goes to $3/MTok and output to $15/MTok. Revisit then.
const PRICING = {
  inputPerMTok: 2,
  outputPerMTok: 10,
  cacheReadPerMTok: 0.2,
  cacheWritePerMTok: 2.5, // 5-minute ephemeral tier
  webSearchPer1k: 10,
};

// ── Event protocol (the contract with components/Chat.tsx) ─────────
// Everything the server streams to the browser is one of these, JSON-
// encoded inside an SSE `data:` frame. Chat.tsx imports these TYPES
// only (a type-only import is erased at build time, so the Anthropic
// SDK never leaks into the browser bundle).
export type SectionKey = "linkedin" | "rera" | "website" | "news";

export type AgentEvent =
  | { type: "phase"; phase: "crux" | "research" | "analysis" | "qa" }
  | { type: "delta"; target: "crux" | "analysis" | "answer"; text: string }
  | { type: "delta"; target: "section"; section: SectionKey; text: string }
  | { type: "search"; query: string }
  | { type: "tool"; name: string }
  | { type: "identity"; verdict: "match" | "verify"; note: string }
  | { type: "section_final"; section: SectionKey; text: string; dropped: number }
  | {
      type: "done";
      runId: string | null;
      usage: RunUsage & { costUsd: number };
      durationMs: number;
    }
  | { type: "error"; message: string; runId: string | null; retryable: boolean }
  | { type: "ping" };

export type SendFn = (event: AgentEvent) => void;

export type RunUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  webSearches: number;
};

export function zeroUsage(): RunUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    webSearches: 0,
  };
}

export function addUsage(a: RunUsage, b: RunUsage): RunUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    webSearches: a.webSearches + b.webSearches,
  };
}

// ── Anthropic client ───────────────────────────────────────────────
// Created lazily and cached, same pattern as the login page's Supabase
// client and zoho.ts's token cache: nothing at module scope needs env
// vars, so `next build` never trips over a missing ANTHROPIC_API_KEY.
let cachedAnthropic: Anthropic | null = null;

function getAnthropic(): Anthropic {
  if (!cachedAnthropic) {
    cachedAnthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY!,
    });
  }
  return cachedAnthropic;
}

// ── Client context loading ─────────────────────────────────────────
// Runs on the RLS-scoped client passed in by the route — so this is
// ALSO the authorization check: if the account isn't visible to this
// salesperson (or doesn't exist), the accounts query comes back empty
// and we return null. The route turns null into the same 404 either
// way, never leaking which case it was (same policy as the client page).
export async function loadClientContext(
  supabase: SupabaseClient,
  accountId: string
): Promise<ClientContext | null> {
  const [accountRes, dealsRes, interactionsRes, findingsRes] =
    await Promise.all([
      supabase
        .from("accounts")
        .select(
          "name, city, industry, ho_location, vertical, working_status, account_unique_number"
        )
        .eq("id", accountId)
        .maybeSingle(),
      supabase
        .from("deals")
        .select("name, stage, contact_name, cities, amount")
        .eq("account_id", accountId),
      supabase
        .from("interactions")
        .select("meeting_date, kind, content")
        .eq("account_id", accountId)
        .order("meeting_date", { ascending: false, nullsFirst: false })
        .limit(30),
      supabase
        .from("client_findings")
        .select(
          "linkedin_findings, rera_findings, website_findings, news_findings, final_analysis, updated_at"
        )
        .eq("account_id", accountId)
        .maybeSingle(),
    ]);

  if (accountRes.error || !accountRes.data) {
    // Distinguish "RLS hid it / doesn't exist" (data: null, no error —
    // expected, silent) from a real query failure (worth a loud log).
    if (accountRes.error) {
      console.error("loadClientContext: accounts query FAILED:", accountRes.error);
    }
    return null;
  }

  const deals = dealsRes.data ?? [];
  // Distinct project cities across all deals — feeds RERA query
  // enrichment (a project registers in ITS city, not the HO city).
  const projectCities = [
    ...new Set(deals.flatMap((d) => d.cities ?? []).filter(Boolean)),
  ];

  return {
    account: accountRes.data,
    projectCities,
    deals,
    interactions: interactionsRes.data ?? [],
    savedFindings: findingsRes.data ?? null,
  };
}

// ── Crux run: "From our existing data" ─────────────────────────────
// No tools, effort medium, small output — the cheap fast opener that
// must reach the phone in under 3 seconds to first token (§9 Phase 3).
export async function runCrux(opts: {
  ctx: ClientContext;
  send: SendFn;
  signal: AbortSignal;
}): Promise<RunUsage> {
  const stream = getAnthropic().messages.stream(
    {
      model: MODEL,
      max_tokens: 1000,
      // Thinking OFF here — the crux is mechanical summarization of data
      // already in the prompt, and the §9 exit metric is first paint
      // <3s. Measured: adaptive thinking cost ~5s to first token;
      // disabled gets under the bar. Research/analysis DO think (§6.2).
      thinking: { type: "disabled" },
      system: [
        {
          type: "text",
          text: CRUX_SYSTEM,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: buildCruxUser(opts.ctx) }],
    },
    // Wire the browser's abort signal all the way through: a salesperson
    // closing the app cancels the Anthropic stream instead of letting it
    // burn tokens for the full run.
    { signal: opts.signal }
  );

  for await (const event of stream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      opts.send({ type: "delta", target: "crux", text: event.delta.text });
    }
  }

  return usageFromMessage(await stream.finalMessage());
}

// ── Section parsing (research stream → per-section events) ─────────
// The research prompt makes the model wrap its output in exact markers
// (<<<IDENTITY:…>>>, <<<SECTION:x>>>, <<<END:x>>>). This class splits
// the raw text stream on those markers and turns it into AgentEvents,
// surviving the two ugly realities of streaming:
//   1. a marker can arrive split across chunks ("<<<SECT" + "ION:rera>>>")
//      → we always hold back the last HOLDBACK chars before emitting;
//   2. the model can drift from the format → flush() degrades safely
//      (finalize what's open; if NO markers ever appeared, dump the text
//      as an unverified "news" section and force the verify banner —
//      never render unvalidated output as trusted, never crash).
const SECTION_KEYS: SectionKey[] = ["linkedin", "rera", "website", "news"];
const MARKER_RE = /<<<(IDENTITY|SECTION|END):([A-Za-z]+)>>>[^\S\n]*([^\n]*)/;
const HOLDBACK = 40; // > longest marker (22 chars), with margin

export class SectionParser {
  private buf = "";
  private current: SectionKey | null = null;
  private sections: Record<SectionKey, string> = {
    linkedin: "",
    rera: "",
    website: "",
    news: "",
  };
  private sawAnyMarker = false;
  private rawText = "";

  push(chunk: string): AgentEvent[] {
    this.buf += chunk;
    this.rawText += chunk;
    return this.drain(false);
  }

  flush(): AgentEvent[] {
    const events = this.drain(true);
    if (this.current) {
      // Model forgot the final <<<END:…>>> — finalize what's open.
      events.push(this.finalizeSection(this.current));
      this.current = null;
    }
    if (!this.sawAnyMarker && this.rawText.trim() !== "") {
      // Catastrophic format failure: no markers at all. Salvage the text
      // into one section, source-checked, and refuse to present it as a
      // confident match.
      console.error(
        "SectionParser: model output had NO markers — salvaging as unverified"
      );
      this.sections.news = this.rawText;
      events.push({
        type: "identity",
        verdict: "verify",
        note: "Research output format was unexpected — please double-check these findings.",
      });
      events.push(this.finalizeSection("news"));
    }
    return events;
  }

  getSections(): Record<SectionKey, string> {
    return { ...this.sections };
  }

  private drain(final: boolean): AgentEvent[] {
    const events: AgentEvent[] = [];

    for (;;) {
      const match = MARKER_RE.exec(this.buf);
      if (!match) break;
      this.sawAnyMarker = true;

      const before = this.buf.slice(0, match.index);
      if (before && this.current) {
        events.push(this.appendToCurrent(before));
      }
      // Text before the first marker (model chatter) is discarded.

      const [, kind, rawKey, rest] = match;
      const key = rawKey.toLowerCase();

      if (kind === "IDENTITY") {
        events.push({
          type: "identity",
          verdict: key === "match" ? "match" : "verify",
          note: rest.trim(),
        });
      } else if (kind === "SECTION" && isSectionKey(key)) {
        if (this.current) {
          // Model skipped an END marker — close the open section first.
          events.push(this.finalizeSection(this.current));
        }
        this.current = key;
      } else if (kind === "END") {
        if (this.current) {
          events.push(this.finalizeSection(this.current));
          this.current = null;
        }
      }
      // Unknown marker kinds/keys are dropped silently — they were
      // never going to render as content anyway.

      this.buf = this.buf.slice(match.index + match[0].length);
    }

    // No complete marker left in the buffer. Emit what's safe to show.
    const cutoff = final ? this.buf.length : Math.max(0, this.buf.length - HOLDBACK);
    if (cutoff > 0) {
      const text = this.buf.slice(0, cutoff);
      this.buf = this.buf.slice(cutoff);
      if (this.current) {
        events.push(this.appendToCurrent(text));
      }
      // Preamble text (no open section) is dropped; the holdback tail
      // stays in buf in case it's the front half of a marker.
    }
    return events;
  }

  private appendToCurrent(text: string): AgentEvent {
    const section = this.current!;
    this.sections[section] += text;
    return { type: "delta", target: "section", section, text };
  }

  private finalizeSection(section: SectionKey): AgentEvent {
    // §13 hard guardrail: unsourced bullets never reach the phone.
    const { text, dropped } = enforceSourceLinks(this.sections[section]);
    this.sections[section] = text;
    return { type: "section_final", section, text, dropped };
  }
}

function isSectionKey(key: string): key is SectionKey {
  return (SECTION_KEYS as string[]).includes(key);
}

// ── Research run: web search sections + final analysis ─────────────
// Two Claude calls in one HTTP request (plan.md §6.3 steps 4–7):
//   call 1 — web_search tool, identity check, four marker-wrapped
//            sections, reflection pass; effort medium;
//   call 2 — FINAL_ANALYSIS at effort high, fed the four FINISHED
//            sections (not the raw search results — those can run to
//            tens of thousands of tokens; the sections are the
//            distillation).
const WEB_SEARCH_TOOL = {
  type: "web_search_20260318" as const,
  name: "web_search" as const,
  // Cost AND latency ceiling. Measured 2026-07-14: 12 searches pushed a
  // hard account to ~150s wall clock (each sandbox round-trip costs
  // seconds); 8 well-chosen queries (~2/section) keeps runs near the
  // <90s exit metric with no visible quality loss.
  max_uses: 8,
};

export async function runResearch(opts: {
  ctx: ClientContext;
  send: SendFn;
  signal: AbortSignal;
}): Promise<{
  sections: Record<SectionKey, string>;
  analysis: string;
  usage: RunUsage;
}> {
  const { ctx, send, signal } = opts;
  const parser = new SectionParser();

  // ── Call 1: search + sections ──
  const stream = getAnthropic().messages.stream(
    {
      model: MODEL,
      max_tokens: 12_000,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      system: [
        {
          type: "text",
          text: RESEARCH_SYSTEM,
          cache_control: { type: "ephemeral" },
        },
      ],
      tools: [WEB_SEARCH_TOOL],
      messages: [{ role: "user", content: buildResearchUser(ctx) }],
    },
    { signal }
  );

  // Search-activity detection, verified against the real wire format
  // (scripts probe, 2026-07-14): web_search_20260318 runs inside a
  // code-execution sandbox, and its server_tool_use block arrives with
  // `input` ALREADY COMPLETE in content_block_start — no input_json_delta
  // follows. The delta-accumulation path below stays as a fallback in
  // case the direct-caller shape (empty start input + streamed JSON)
  // also occurs.
  const pendingSearches = new Map<number, string>();

  for await (const event of stream) {
    switch (event.type) {
      case "content_block_start":
        if (
          event.content_block.type === "server_tool_use" &&
          event.content_block.name === "web_search"
        ) {
          const query = (event.content_block.input as { query?: unknown })
            ?.query;
          if (typeof query === "string" && query !== "") {
            send({ type: "search", query });
          } else {
            pendingSearches.set(event.index, "");
          }
        }
        break;
      case "content_block_delta":
        if (event.delta.type === "text_delta") {
          for (const e of parser.push(event.delta.text)) send(e);
        } else if (
          event.delta.type === "input_json_delta" &&
          pendingSearches.has(event.index)
        ) {
          pendingSearches.set(
            event.index,
            pendingSearches.get(event.index)! + event.delta.partial_json
          );
        }
        break;
      case "content_block_stop":
        if (pendingSearches.has(event.index)) {
          try {
            const query = JSON.parse(pendingSearches.get(event.index)!)?.query;
            if (query) send({ type: "search", query });
          } catch {
            // partial/odd input JSON — activity indicator only, skip
          }
          pendingSearches.delete(event.index);
        }
        break;
    }
  }
  for (const e of parser.flush()) send(e);
  let usage = usageFromMessage(await stream.finalMessage());
  const sections = parser.getSections();

  // ── Call 2: final analysis ──
  send({ type: "phase", phase: "analysis" });
  let analysis = "";
  const analysisStream = getAnthropic().messages.stream(
    {
      model: MODEL,
      max_tokens: 8_000,
      thinking: { type: "adaptive" },
      // The output that matters most gets the deepest thinking (§6.4).
      output_config: { effort: "high" },
      system: [
        {
          type: "text",
          text: ANALYSIS_SYSTEM,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: buildAnalysisUser(ctx, sections) }],
    },
    { signal }
  );

  for await (const event of analysisStream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      analysis += event.delta.text;
      send({ type: "delta", target: "analysis", text: event.delta.text });
    }
  }
  usage = addUsage(usage, usageFromMessage(await analysisStream.finalMessage()));

  return { sections, analysis, usage };
}

// ── Q&A run: database-first tool loop ──────────────────────────────
// Custom tools answer from the ClientContext ALREADY loaded through the
// RLS-scoped client — no fresh queries, so the model structurally cannot
// reach data outside this account, whatever it asks for. web_search is
// the prompt-enforced last resort (server-side tool, runs inline — it
// never surfaces as stop_reason "tool_use"; only our custom tools do).
export type SectionTexts = {
  linkedin: string;
  rera: string;
  website: string;
  news: string;
  analysis: string;
};

// Module constants, byte-stable across requests — tool definitions are
// part of the cached prompt prefix (see the caching note in prompts.ts).
const QA_TOOLS: Anthropic.MessageCreateParams["tools"] = [
  { type: "web_search_20260318", name: "web_search", max_uses: 3 },
  {
    name: "get_account",
    description:
      "The CRM account record for this client: city, industry, vertical, working status, project cities.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_interactions",
    description:
      "Meeting/note history for this client, newest first. Optional limit (1-30, default 10).",
    input_schema: {
      type: "object",
      properties: { limit: { type: "number" } },
    },
  },
  {
    name: "get_saved_findings",
    description:
      "Previously saved research for this client (four sections + analysis) with its saved date, if any.",
    input_schema: { type: "object", properties: {} },
  },
];

const QA_MAX_ITERATIONS = 4;

function execQaTool(name: string, input: unknown, ctx: ClientContext): unknown {
  switch (name) {
    case "get_account":
      return { ...ctx.account, project_cities: ctx.projectCities, deals: ctx.deals };
    case "get_interactions": {
      const requested = Number((input as { limit?: unknown })?.limit);
      const limit = Math.min(30, Math.max(1, Number.isFinite(requested) ? requested : 10));
      return ctx.interactions.slice(0, limit).map((i) => ({
        date: i.meeting_date?.slice(0, 10) ?? "undated",
        note: (i.content ?? "").slice(0, 600),
      }));
    }
    case "get_saved_findings":
      return ctx.savedFindings
        ? { saved: true, ...ctx.savedFindings }
        : { saved: false };
    default:
      return { error: `unknown tool ${name}` };
  }
}

export async function runQA(opts: {
  ctx: ClientContext;
  sections: SectionTexts | null;
  messages: { role: "user" | "assistant"; content: string }[];
  send: SendFn;
  signal: AbortSignal;
}): Promise<RunUsage> {
  const { ctx, sections, send, signal } = opts;

  // Context preamble as the first user turn, then the client-held
  // transcript (last message = the new question).
  const msgs: Anthropic.MessageParam[] = [
    { role: "user", content: buildQaContext(ctx, sections) },
    ...opts.messages,
  ];

  let usage = zeroUsage();

  for (let iteration = 0; iteration < QA_MAX_ITERATIONS; iteration++) {
    const stream = getAnthropic().messages.stream(
      {
        model: MODEL,
        max_tokens: 4000,
        thinking: { type: "adaptive" },
        output_config: { effort: "medium" },
        system: [
          { type: "text", text: QA_SYSTEM, cache_control: { type: "ephemeral" } },
        ],
        tools: QA_TOOLS,
        messages: msgs,
      },
      { signal }
    );

    for await (const event of stream) {
      if (
        event.type === "content_block_start" &&
        event.content_block.type === "server_tool_use" &&
        event.content_block.name === "web_search"
      ) {
        const query = (event.content_block.input as { query?: unknown })?.query;
        if (typeof query === "string" && query !== "") {
          send({ type: "search", query });
        }
      } else if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        send({ type: "delta", target: "answer", text: event.delta.text });
      }
    }

    const final = await stream.finalMessage();
    usage = addUsage(usage, usageFromMessage(final));

    if (final.stop_reason !== "tool_use") return usage;

    // Custom tool round: echo the assistant turn back verbatim, execute
    // each requested tool against the (RLS-loaded) context, continue.
    msgs.push({ role: "assistant", content: final.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const block of final.content) {
      if (block.type === "tool_use") {
        send({ type: "tool", name: block.name });
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(execQaTool(block.name, block.input, ctx)),
        });
      }
    }
    msgs.push({ role: "user", content: results });
  }

  // Iteration cap hit — close the answer honestly rather than hanging.
  send({
    type: "delta",
    target: "answer",
    text: "\n\n(Stopped — too many lookups for one question. Try asking something more specific.)",
  });
  return usage;
}

// ── Usage + cost ───────────────────────────────────────────────────
function usageFromMessage(message: Anthropic.Message): RunUsage {
  const u = message.usage;
  return {
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
    webSearches: u.server_tool_use?.web_search_requests ?? 0,
  };
}

export function estimateCostUsd(usage: RunUsage): number {
  const cost =
    (usage.inputTokens * PRICING.inputPerMTok +
      usage.outputTokens * PRICING.outputPerMTok +
      usage.cacheReadTokens * PRICING.cacheReadPerMTok +
      usage.cacheWriteTokens * PRICING.cacheWritePerMTok) /
      1_000_000 +
    (usage.webSearches * PRICING.webSearchPer1k) / 1_000;
  // research_logs.estimated_cost_usd is numeric(10,5) — round to match.
  return Math.round(cost * 100_000) / 100_000;
}

// ── Run logging ────────────────────────────────────────────────────
// Inserts via the ADMIN client (users have no INSERT policy on
// research_logs by design) with the user id stamped on. Never throws:
// a failed log write must not kill a research run the salesperson is
// watching — it logs loudly and returns null instead.
export async function logRun(
  admin: SupabaseClient,
  row: {
    userId: string;
    accountId: string;
    runType: "research" | "qa";
    usage: RunUsage;
    durationMs: number;
    error?: string;
  }
): Promise<string | null> {
  const { data, error } = await admin
    .from("research_logs")
    .insert({
      user_id: row.userId,
      account_id: row.accountId,
      run_type: row.runType,
      model: MODEL,
      input_tokens: row.usage.inputTokens,
      output_tokens: row.usage.outputTokens,
      cache_read_tokens: row.usage.cacheReadTokens,
      estimated_cost_usd: estimateCostUsd(row.usage),
      duration_ms: row.durationMs,
      error: row.error ?? null,
    })
    .select("id")
    .single();

  if (error) {
    console.error("research_logs insert FAILED (run continues):", error);
    return null;
  }
  return data.id as string;
}
