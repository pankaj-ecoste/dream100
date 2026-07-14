// The agent orchestrator endpoint. One route, three stages (crux /
// research / qa), each a self-contained POST — the server keeps NO
// conversation state between requests; the browser holds the transcript.
//
// Response is a Server-Sent Events stream: `data: <AgentEvent JSON>\n\n`
// frames, ending with a "done" (or "error") event. The fork's blessed
// streaming pattern (node_modules/next/dist/docs/02-guides/streaming.md):
// return a plain `new Response(readableStream)`.
//
// Trust chain, in order:
//   1. proxy.ts already redirects logged-out users away from /api/chat
//      (its matcher only exempts api/zoho) — but we re-check the session
//      here anyway; a route must never rely on middleware alone.
//   2. loadClientContext runs on the RLS-scoped client → an account this
//      salesperson can't see returns null → 404, before any model call.
//   3. Only the research_logs write uses the admin client, stamped with
//      the session user's id.
//
// PRODUCTION DEBUG MAP: "research broken in prod" → Vercel function logs
// for this route. Streams dying at exactly 60s → Fluid Compute is off on
// the Vercel project (Hobby caps non-Fluid functions at 60s; maxDuration
// below is only honored with Fluid on).
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  loadClientContext,
  runCrux,
  runResearch,
  runQA,
  logRun,
  zeroUsage,
  estimateCostUsd,
  type AgentEvent,
  type RunUsage,
} from "@/lib/agent";

// Research target is <90s but adaptive thinking + 12 web searches can
// legitimately take longer; streaming keeps the connection alive.
export const maxDuration = 300;

// One schema per stage, discriminated on `stage`. crux/research send
// only the account id — the server rebuilds CRM context itself, so a
// tampered client can never feed the model fake context. qa additionally
// carries the client-held transcript and any unsaved fresh sections.
const sectionTextsSchema = z.object({
  linkedin: z.string().max(12_000),
  rera: z.string().max(12_000),
  website: z.string().max(12_000),
  news: z.string().max(12_000),
  analysis: z.string().max(16_000),
});

const chatBodySchema = z.discriminatedUnion("stage", [
  z.object({ stage: z.literal("crux"), accountId: z.uuid() }),
  z.object({ stage: z.literal("research"), accountId: z.uuid() }),
  z.object({
    stage: z.literal("qa"),
    accountId: z.uuid(),
    sections: sectionTextsSchema.nullable(),
    messages: z
      .array(
        z.object({
          role: z.enum(["user", "assistant"]),
          content: z.string().min(1).max(4_000),
        })
      )
      .min(1)
      .max(24),
  }),
]);

export async function POST(request: NextRequest) {
  // 1. Who is asking? (RLS-scoped client — acts AS the salesperson.)
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // 2. Is the payload well-formed?
  const parsed = chatBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }
  const body = parsed.data;

  // 3. Can this salesperson see this account? RLS answers — a missing
  // account and a forbidden account both come back null → same 404.
  // This is the §9 exit metric "asking about a non-assigned account is
  // refused", enforced before a single model token is spent.
  const ctx = await loadClientContext(supabase, body.accountId);
  if (!ctx) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // 4. Stream the run as SSE.
  const admin = createAdminClient();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      // enqueue throws once the client has disconnected — wrap it so a
      // closed phone screen never turns into an unhandled crash here.
      let closed = false;
      const send = (event: AgentEvent) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
          );
        } catch {
          closed = true;
        }
      };

      // Adaptive thinking can sit silent for tens of seconds; pings keep
      // mobile networks and proxies from killing the idle connection.
      const ping = setInterval(() => send({ type: "ping" }), 15_000);

      const startedAt = Date.now();
      let usage: RunUsage = zeroUsage();

      try {
        send({ type: "phase", phase: body.stage });

        if (body.stage === "crux") {
          usage = await runCrux({ ctx, send, signal: request.signal });
        } else if (body.stage === "research") {
          ({ usage } = await runResearch({
            ctx,
            send,
            signal: request.signal,
          }));
        } else {
          usage = await runQA({
            ctx,
            sections: body.sections,
            messages: body.messages,
            send,
            signal: request.signal,
          });
        }

        const durationMs = Date.now() - startedAt;
        const runId = await logRun(admin, {
          userId: user.id,
          accountId: body.accountId,
          // crux counts as part of the research flow; research_logs'
          // CHECK constraint has no separate 'crux' value
          runType: body.stage === "qa" ? "qa" : "research",
          usage,
          durationMs,
        });
        send({
          type: "done",
          runId,
          usage: { ...usage, costUsd: estimateCostUsd(usage) },
          durationMs,
        });
      } catch (err) {
        // Failure path is logged too — cost visibility includes broken
        // runs, and the error column is how we spot patterns (§13).
        console.error("chat route: run FAILED", body.stage, body.accountId, err);
        const aborted = request.signal.aborted;
        const runId = await logRun(admin, {
          userId: user.id,
          accountId: body.accountId,
          runType: body.stage === "qa" ? "qa" : "research",
          usage,
          durationMs: Date.now() - startedAt,
          error: aborted ? "client aborted" : String(err),
        });
        send({
          type: "error",
          message: aborted
            ? "cancelled"
            : "The run failed partway. Tap retry — nothing was saved.",
          runId,
          retryable: !aborted,
        });
      } finally {
        clearInterval(ping);
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed by the runtime — fine
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      // no-transform matters: without it, proxies/CDNs may buffer the
      // stream and the "progressive" UI arrives all at once at the end.
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
