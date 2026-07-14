// Display formatters (Phase 2) + agent-output enforcement (Phase 3).
//
// The Phase 3 half is a plan.md §13 shipping requirement, not polish:
// "format.ts drops bullets without source links before rendering."
// The prompt TELLS the model every bullet needs a source link;
// enforceSourceLinks is the code that makes it true even when the
// model slips. It runs server-side when a section finishes streaming
// (SectionParser in lib/agent.ts), and can only ever REMOVE text —
// it has no way to add or alter a claim.

// "Synced 14:32" — always in IST, regardless of where the server runs.
// Vercel's serverless functions default their process timezone to UTC,
// so without pinning timeZone explicitly, every salesperson would see a
// freshness stamp 5.5 hours off from the actual sync time.
export function formatSyncedAt(timestamp: string | null): string {
  if (!timestamp) return "Not yet synced";
  const time = new Date(timestamp).toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `Synced ${time}`;
}

export function formatINR(amount: number | null): string {
  if (amount == null) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

// "12 Jul 2026" — used on Timeline rows.
export function formatDate(timestamp: string | null): string {
  if (!timestamp) return "Undated";
  return new Date(timestamp).toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// ── Phase 3: source-link enforcement on agent findings ─────────────

// A "source link" is a markdown link to an http(s) URL, or a bare
// http(s) URL. Anything else (bracketed text, "source: internet") does
// not count.
const SOURCE_LINK_RE = /\[[^\]]+\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s)]+/;

export function hasSourceLink(line: string): boolean {
  return SOURCE_LINK_RE.test(line);
}

const BULLET_RE = /^\s*(?:[-*•]|\d+\.)\s+/;

/**
 * Drops every bullet that lacks a source link. Line-based:
 * - bullet lines (-, *, •, "1.") survive only with a link in them;
 *   indented continuation lines belong to the bullet above and fall
 *   with it;
 * - non-bullet lines (the honest empty-state sentences, sub-headings)
 *   pass through untouched;
 * - if enforcement leaves nothing behind, the section becomes an
 *   explicit note rather than silent blankness.
 */
export function enforceSourceLinks(sectionText: string): {
  text: string;
  dropped: number;
} {
  const lines = sectionText.split("\n");
  const kept: string[] = [];
  let dropped = 0;
  let droppingContinuation = false;

  for (const line of lines) {
    if (BULLET_RE.test(line)) {
      if (hasSourceLink(line)) {
        kept.push(line);
        droppingContinuation = false;
      } else {
        dropped++;
        droppingContinuation = true;
      }
    } else if (line.trim() === "") {
      kept.push(line);
      droppingContinuation = false;
    } else if (droppingContinuation && /^\s+/.test(line)) {
      // indented continuation of a dropped bullet — falls with it
    } else {
      kept.push(line);
      droppingContinuation = false;
    }
  }

  const text = kept.join("\n").trim();
  if (text === "" && dropped > 0) {
    return {
      text: "No verifiable findings — items found lacked source links.",
      dropped,
    };
  }
  return { text, dropped };
}
