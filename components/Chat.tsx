"use client";
// The research panel on the client screen — the first client component
// with real state in this codebase (SearchBar and friends are Server
// Components). It drives the multi-stage agent flow against /api/chat:
//
//   crux (auto, on mount) → consent tap → research sections + analysis
//   → Q&A follow-ups
//
// The server keeps no conversation state; everything streamed in lives
// in this component's reducer. Events arrive via lib/sse-client.ts as
// AgentEvent objects and map 1:1 onto reducer actions — if the UI shows
// something wrong, the bug is either the event (server) or the reducer
// case (here), nothing in between.
//
// PRODUCTION DEBUG MAP: "research button does nothing / text stops
// mid-stream" → Network tab first (is /api/chat still streaming?), then
// the reducer here, then app/api/chat/route.ts.
import { useEffect, useReducer, useRef, useState } from "react";
import { streamChat, type ChatRequestBody } from "@/lib/sse-client";
import type { AgentEvent, SectionKey, SectionTexts } from "@/lib/agent"; // type-only: erased at build
import { formatDate } from "@/lib/format";
import AgentText from "./AgentText";
import FindingsSection from "./FindingsSection";
import FeedbackButtons from "./FeedbackButtons";
import SaveDialog from "./SaveDialog";

type RetryStage = "crux" | "research";

type SectionData = { text: string; final: boolean; dropped: number };

type QaMessage = {
  role: "user" | "assistant";
  content: string;
  runId?: string | null;
};

const SECTION_ORDER: { key: SectionKey; title: string }[] = [
  { key: "linkedin", title: "People" },
  { key: "rera", title: "RERA & Projects" },
  { key: "website", title: "Website" },
  { key: "news", title: "News" },
];

// The server caps the transcript at 24 messages; trim oldest first.
const QA_TRANSCRIPT_LIMIT = 24;

type ChatState = {
  // consent = crux done, waiting for the human go-ahead before web
  // research spends money; ready = research finished, Q&A open.
  phase: "crux" | "consent" | "research" | "analysis" | "ready";
  busy: boolean;
  crux: string;
  identity: { verdict: "match" | "verify"; note: string } | null;
  sections: Record<SectionKey, SectionData | null>;
  analysis: string;
  searches: string[];
  researchRunId: string | null;
  error: { message: string; retryStage: RetryStage } | null;
  qa: {
    messages: QaMessage[];
    pending: string;
    busy: boolean;
    activity: string | null;
    error: string | null;
  };
};

type ChatAction =
  | { kind: "start"; stage: RetryStage }
  | { kind: "event"; stream: "main" | "qa"; event: AgentEvent }
  | { kind: "fail"; stream: "main" | "qa"; message: string; retryStage: RetryStage }
  | { kind: "qa-send"; question: string };

const emptySections: Record<SectionKey, SectionData | null> = {
  linkedin: null,
  rera: null,
  website: null,
  news: null,
};

const initialState: ChatState = {
  phase: "crux",
  busy: true,
  crux: "",
  identity: null,
  sections: emptySections,
  analysis: "",
  searches: [],
  researchRunId: null,
  error: null,
  qa: { messages: [], pending: "", busy: false, activity: null, error: null },
};

function reducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.kind) {
    case "start":
      if (action.stage === "crux") return { ...initialState };
      // (Re)starting research resets research state but keeps the crux.
      return {
        ...state,
        phase: "research",
        busy: true,
        identity: null,
        sections: emptySections,
        analysis: "",
        searches: [],
        researchRunId: null,
        error: null,
        qa: initialState.qa,
      };

    case "qa-send":
      return {
        ...state,
        qa: {
          ...state.qa,
          messages: [...state.qa.messages, { role: "user", content: action.question }],
          pending: "",
          busy: true,
          activity: null,
          error: null,
        },
      };

    case "fail":
      if (action.stream === "qa") {
        return {
          ...state,
          qa: { ...state.qa, busy: false, pending: "", activity: null, error: action.message },
        };
      }
      return {
        ...state,
        busy: false,
        error: { message: action.message, retryStage: action.retryStage },
      };

    case "event":
      return action.stream === "qa"
        ? qaEvent(state, action.event)
        : mainEvent(state, action.event);
  }
}

function mainEvent(state: ChatState, e: AgentEvent): ChatState {
  switch (e.type) {
    case "delta":
      if (e.target === "crux") return { ...state, crux: state.crux + e.text };
      if (e.target === "analysis")
        return { ...state, analysis: state.analysis + e.text };
      if (e.target === "section") {
        const prev = state.sections[e.section];
        return {
          ...state,
          sections: {
            ...state.sections,
            [e.section]: {
              text: (prev?.text ?? "") + e.text,
              final: false,
              dropped: 0,
            },
          },
        };
      }
      return state;

    case "section_final":
      return {
        ...state,
        sections: {
          ...state.sections,
          [e.section]: { text: e.text, final: true, dropped: e.dropped },
        },
      };

    case "search":
      return { ...state, searches: [...state.searches, e.query] };

    case "identity":
      return { ...state, identity: { verdict: e.verdict, note: e.note } };

    case "phase":
      return e.phase === "analysis" ? { ...state, phase: "analysis" } : state;

    case "done":
      if (state.phase === "crux") {
        return { ...state, phase: "consent", busy: false };
      }
      return { ...state, phase: "ready", busy: false, researchRunId: e.runId };

    case "error":
      return {
        ...state,
        busy: false,
        error: {
          message: e.message,
          retryStage: state.phase === "crux" ? "crux" : "research",
        },
      };

    default:
      return state; // ping
  }
}

function qaEvent(state: ChatState, e: AgentEvent): ChatState {
  switch (e.type) {
    case "delta":
      if (e.target === "answer") {
        return { ...state, qa: { ...state.qa, pending: state.qa.pending + e.text, activity: null } };
      }
      return state;
    case "tool":
      return { ...state, qa: { ...state.qa, activity: "Checking our records…" } };
    case "search":
      return { ...state, qa: { ...state.qa, activity: `Searching: ${e.query}` } };
    case "done":
      return {
        ...state,
        qa: {
          ...state.qa,
          messages: [
            ...state.qa.messages,
            { role: "assistant", content: state.qa.pending, runId: e.runId },
          ],
          pending: "",
          busy: false,
          activity: null,
          error: null,
        },
      };
    case "error":
      return {
        ...state,
        qa: { ...state.qa, busy: false, pending: "", activity: null, error: e.message },
      };
    default:
      return state; // ping, phase
  }
}

export default function Chat({
  accountId,
  savedAt,
}: {
  accountId: string;
  savedAt: string | null;
}) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [question, setQuestion] = useState("");
  // One in-flight request at a time; firing a stage cancels the previous
  // stream (and with it the server's Anthropic call — request.signal is
  // wired all the way through).
  const controllerRef = useRef<AbortController | null>(null);

  function abortAndNewController(): AbortController {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    return controller;
  }

  function fireStage(stage: RetryStage) {
    const controller = abortAndNewController();
    dispatch({ kind: "start", stage });

    const body: ChatRequestBody = { stage, accountId };
    streamChat(
      body,
      (event) => dispatch({ kind: "event", stream: "main", event }),
      controller.signal
    ).catch((err: unknown) => {
      // An abort is us cancelling on purpose (unmount/stop/retry) —
      // silence, not an error box.
      if (controller.signal.aborted) return;
      dispatch({
        kind: "fail",
        stream: "main",
        message: err instanceof Error ? err.message : "Something went wrong.",
        retryStage: stage,
      });
    });
  }

  function fireQa(text: string) {
    const trimmed = text.trim();
    if (!trimmed || state.qa.busy) return;
    const controller = abortAndNewController();
    dispatch({ kind: "qa-send", question: trimmed });
    setQuestion("");

    // Fresh sections travel with the request (they may be unsaved, so
    // the server can't read them from the DB).
    const allFinal = SECTION_ORDER.every((s) => state.sections[s.key]?.final);
    const sections: SectionTexts | null =
      allFinal && state.analysis
        ? {
            linkedin: state.sections.linkedin!.text,
            rera: state.sections.rera!.text,
            website: state.sections.website!.text,
            news: state.sections.news!.text,
            analysis: state.analysis,
          }
        : null;

    const transcript = [
      ...state.qa.messages.map(({ role, content }) => ({ role, content })),
      { role: "user" as const, content: trimmed },
    ].slice(-QA_TRANSCRIPT_LIMIT);

    streamChat(
      { stage: "qa", accountId, sections, messages: transcript },
      (event) => dispatch({ kind: "event", stream: "qa", event }),
      controller.signal
    ).catch((err: unknown) => {
      if (controller.signal.aborted) return;
      dispatch({
        kind: "fail",
        stream: "qa",
        message: err instanceof Error ? err.message : "Something went wrong.",
        retryStage: "research",
      });
    });
  }

  // Auto-fire the crux on mount. In dev, React StrictMode mounts twice:
  // the first mount's cleanup aborts its request, the second completes —
  // one cheap aborted call in dev only, correct behavior in prod.
  useEffect(() => {
    fireStage("crux");
    return () => controllerRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  const researching =
    state.busy && (state.phase === "research" || state.phase === "analysis");
  const latestSearch = state.searches[state.searches.length - 1];

  return (
    <div>
      {/* ── Meeting prep card: crux + consent + activity ── */}
      <section className="mt-4 rounded-2xl bg-white p-6 shadow-sm">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-base font-semibold text-brand-blue-dark">
            Meeting prep
          </h2>
          {savedAt && (
            <span className="text-xs text-zinc-400">
              Saved research: {formatDate(savedAt)}
            </span>
          )}
        </div>

        {state.crux ? (
          <AgentText text={state.crux} />
        ) : (
          state.busy && (
            <p className="text-sm text-zinc-400">
              Reading this client&apos;s record…
            </p>
          )
        )}

        {state.error && (
          <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            <p>{state.error.message}</p>
            <button
              type="button"
              onClick={() => fireStage(state.error!.retryStage)}
              className="mt-1 font-semibold underline underline-offset-2"
            >
              Retry
            </button>
          </div>
        )}

        {/* Consent gate: web research costs money and takes ~a minute —
            it never starts without this tap (plan.md §6.3 step 3). */}
        {state.phase === "consent" && !state.error && (
          <button
            type="button"
            onClick={() => fireStage("research")}
            className="mt-4 w-full rounded-lg bg-brand-green py-3 text-base font-semibold text-white transition-colors hover:bg-brand-green-dark"
          >
            Research this client on the web
          </button>
        )}

        {researching && (
          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="min-w-0 flex-1 truncate text-xs text-zinc-500">
              <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-brand-green align-middle" />
              {state.phase === "analysis"
                ? "Thinking about how to approach this meeting…"
                : latestSearch
                  ? `Searching: ${latestSearch}`
                  : "Starting web research…"}
            </p>
            <button
              type="button"
              onClick={() => {
                controllerRef.current?.abort();
                dispatch({
                  kind: "fail",
                  stream: "main",
                  message: "Stopped. Findings above are partial.",
                  retryStage: "research",
                });
              }}
              className="shrink-0 text-xs font-medium text-zinc-400 underline underline-offset-2"
            >
              Stop
            </button>
          </div>
        )}
      </section>

      {/* ── Identity warning: wrong-company research is the most
             damaging failure mode (§13) ── */}
      {state.identity?.verdict === "verify" && (
        <div className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">Possible match — please verify</p>
          <p className="mt-1">
            {state.identity.note ||
              "The companies found online may not be this client. Double-check before using these findings."}
          </p>
        </div>
      )}

      {/* ── Section cards, appearing as they stream ── */}
      {SECTION_ORDER.map(({ key, title }) => {
        const data = state.sections[key];
        return data ? (
          <FindingsSection
            key={key}
            title={title}
            text={data.text}
            final={data.final}
            dropped={data.dropped}
          />
        ) : null;
      })}

      {/* ── Final analysis ── */}
      {(state.phase === "analysis" || state.phase === "ready") && (
        <section className="mt-4 rounded-2xl border-2 border-brand-blue/20 bg-white p-6 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-brand-blue-dark">
            How to approach this meeting
          </h3>
          {state.analysis ? (
            <AgentText text={state.analysis} />
          ) : (
            <p className="text-sm text-zinc-400">Thinking…</p>
          )}
          {state.phase === "ready" && (
            <div className="mt-4 space-y-3 border-t border-zinc-100 pt-3">
              {state.researchRunId && (
                <FeedbackButtons runId={state.researchRunId} />
              )}
              {SECTION_ORDER.every((s) => state.sections[s.key]?.final) &&
                state.analysis && (
                  <SaveDialog
                    accountId={accountId}
                    previouslySavedAt={savedAt}
                    sections={{
                      linkedin: state.sections.linkedin!.text,
                      rera: state.sections.rera!.text,
                      website: state.sections.website!.text,
                      news: state.sections.news!.text,
                      analysis: state.analysis,
                    }}
                  />
                )}
            </div>
          )}
        </section>
      )}

      {/* ── Q&A follow-ups ── */}
      {state.phase === "ready" && (
        <section className="mt-4 rounded-2xl bg-white p-6 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-brand-blue-dark">
            Ask a follow-up
          </h3>

          <div className="space-y-3">
            {state.qa.messages.map((m, i) =>
              m.role === "user" ? (
                <p
                  key={i}
                  className="ml-8 rounded-xl bg-brand-blue/5 px-3 py-2 text-sm text-zinc-800"
                >
                  {m.content}
                </p>
              ) : (
                <div key={i} className="text-sm">
                  <AgentText text={m.content} />
                  {m.runId && (
                    <div className="mt-1.5">
                      <FeedbackButtons runId={m.runId} />
                    </div>
                  )}
                </div>
              )
            )}

            {state.qa.pending && <AgentText text={state.qa.pending} />}
            {state.qa.busy && (
              <p className="text-xs text-zinc-400">
                <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-brand-blue align-middle" />
                {state.qa.activity ?? "Thinking…"}
              </p>
            )}
            {state.qa.error && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                {state.qa.error} — ask again.
              </p>
            )}
          </div>

          <form
            className="mt-4 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              fireQa(question);
            }}
          >
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="e.g. When did we last meet them?"
              maxLength={2000}
              className="min-w-0 flex-1 rounded-lg border border-zinc-300 px-3 py-2.5 text-base outline-none focus:border-brand-blue"
            />
            <button
              type="submit"
              disabled={state.qa.busy || question.trim() === ""}
              className="shrink-0 rounded-lg bg-brand-blue px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-blue-dark disabled:opacity-50"
            >
              Ask
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
