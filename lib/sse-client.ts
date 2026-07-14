// Browser-side SSE consumer for /api/chat — the one place stream-frame
// parsing lives. Runs only in "use client" components.
//
// Why not the browser's built-in EventSource? EventSource only does GET
// with no body; our chat endpoint is a POST. So we read the fetch body
// stream by hand: bytes → text → frames split on the SSE "\n\n"
// delimiter → JSON events. ~30 lines, no library.
//
// PRODUCTION DEBUG MAP: "UI freezes mid-research / events stop applying"
// → parsing bug here or a malformed frame from app/api/chat/route.ts.
// Check the Network tab: the raw frames are readable text.
import type { AgentEvent } from "./agent"; // type-only: erased at build

export type ChatRequestBody =
  | { stage: "crux"; accountId: string }
  | { stage: "research"; accountId: string }
  | {
      stage: "qa";
      accountId: string;
      sections: {
        linkedin: string;
        rera: string;
        website: string;
        news: string;
        analysis: string;
      } | null;
      messages: { role: "user" | "assistant"; content: string }[];
    };

// Resolves when the stream ends cleanly; throws on HTTP errors (401/
// 404/501...) with the server's error message, and on network failures.
// AbortError from `signal` also lands in the caller's catch — callers
// treat that one as silence, not failure.
export async function streamChat(
  body: ChatRequestBody,
  onEvent: (event: AgentEvent) => void,
  signal: AbortSignal
): Promise<void> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok || !res.body) {
    const message = (await res.json().catch(() => null))?.error;
    throw new Error(message ?? `Request failed (HTTP ${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    // stream:true keeps multi-byte characters split across network
    // chunks intact (₹, Hindi text in notes, …).
    buffer += decoder.decode(value, { stream: true });

    let frameEnd;
    while ((frameEnd = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, frameEnd);
      buffer = buffer.slice(frameEnd + 2);
      if (frame.startsWith("data: ")) {
        onEvent(JSON.parse(frame.slice(6)) as AgentEvent);
      }
    }
  }
}
