// Phase 4 — the mechanical diff between a saved research picture and a
// fresh one. This file is the WHOLE reason the repeat-visit comparison
// can promise "zero invented changes" (plan.md §9 Phase 4 hard gate,
// §13 "comparison narrates code-computed diffs"): the LLM never decides
// what changed. Code does, here. The COMPARISON prompt only NARRATES the
// output of diffFindings — it is handed the new findings and can drop one
// as immaterial, but it has nothing from which to invent a change.
//
// Why diff by SOURCE URL, not by text:
//   A research re-run does a fresh live web search every time, so an
//   unchanged fact comes back reworded, or cited to a different article,
//   almost every run. Comparing bullet TEXT would flag those as changes
//   and blow the hard gate. Instead we compare the SET of source URLs a
//   section cites: a fresh bullet is a candidate "new finding" only if
//   its URL was not in the previously-saved picture. A URL that fails to
//   reappear is NOT reported as removed — that is search variability, not
//   evidence the fact stopped being true.
//
// PRODUCTION DEBUG MAP:
//   "comparison reports a change that didn't happen"  → normalizeUrl /
//        extractUrls here first (are two links to the same page failing
//        to match?), then the COMPARISON prompt in lib/prompts.ts
//   "comparison misses a real change"                 → diffFindings here
//        (did the fresh bullet carry a genuinely new URL?)
import type { SectionKey } from "./agent";

const SECTION_KEYS: SectionKey[] = ["linkedin", "rera", "website", "news"];

// Same shape format.ts uses to validate source links, but as a global
// matcher so we can pull EVERY url out of a section, not just test one
// line. Markdown links and bare urls both count.
const URL_RE = /https?:\/\/[^\s)\]]+/g;

// The saved picture as it comes off client_findings (four section
// columns). Any column can be null (an honestly-empty section at save
// time).
export type SavedSections = {
  linkedin_findings: string | null;
  rera_findings: string | null;
  website_findings: string | null;
  news_findings: string | null;
};

// The fresh sections produced by the current research run (SectionParser
// output in lib/agent.ts) — always all four present, possibly empty.
export type FreshSections = Record<SectionKey, string>;

export type SectionDiff = { newBullets: string[] };

export type FindingsDiff = {
  hasChanges: boolean;
  sections: Record<SectionKey, SectionDiff>;
};

// Collapse cosmetic URL differences so two links to the SAME page match
// and don't read as a change: drop the scheme, a leading "www.", any
// query string or #fragment, and a trailing slash; lowercase the host.
// The path's case is preserved — some servers are path-case-sensitive.
export function normalizeUrl(raw: string): string {
  let u = raw.trim();
  // Strip trailing markdown/sentence punctuation that clings to a bare url.
  u = u.replace(/[.,;:!?)\]]+$/, "");
  u = u.replace(/^https?:\/\//i, "");
  u = u.replace(/^www\./i, "");
  u = u.replace(/[?#].*$/, ""); // query + fragment
  u = u.replace(/\/+$/, ""); // trailing slash(es)
  const slash = u.indexOf("/");
  if (slash === -1) return u.toLowerCase();
  // Lowercase host only; leave the path untouched.
  return u.slice(0, slash).toLowerCase() + u.slice(slash);
}

// Every normalized source URL cited anywhere in a section's text.
export function extractUrls(sectionText: string | null): Set<string> {
  const set = new Set<string>();
  if (!sectionText) return set;
  for (const match of sectionText.matchAll(URL_RE)) {
    set.add(normalizeUrl(match[0]));
  }
  return set;
}

const BULLET_RE = /^\s*(?:[-*•]|\d+\.)\s+/;

// A section's fresh bullets whose URL(s) are ALL absent from the saved
// picture for that same section. A bullet with no url at all is skipped
// (format.ts already dropped unsourced bullets before save AND before
// this runs, so in practice every real finding has one; a stray
// empty-state sentence like "No RERA presence found." carries no url and
// is correctly not treated as a change).
function diffSection(savedText: string | null, freshText: string): SectionDiff {
  const savedUrls = extractUrls(savedText);
  const newBullets: string[] = [];

  for (const line of freshText.split("\n")) {
    if (!BULLET_RE.test(line)) continue;
    const urls = [...line.matchAll(URL_RE)].map((m) => normalizeUrl(m[0]));
    if (urls.length === 0) continue;
    // "New" = not a single one of this bullet's sources was seen before.
    // If ANY url overlaps the saved set, treat the bullet as already-known
    // (same source resurfacing) and stay silent — bias toward NOT
    // reporting, which is the safe direction for the hard gate.
    const allNew = urls.every((u) => !savedUrls.has(u));
    if (allNew) newBullets.push(line.trim());
  }

  return { newBullets };
}

export function diffFindings(
  saved: SavedSections,
  fresh: FreshSections
): FindingsDiff {
  const savedByKey: Record<SectionKey, string | null> = {
    linkedin: saved.linkedin_findings,
    rera: saved.rera_findings,
    website: saved.website_findings,
    news: saved.news_findings,
  };

  const sections = {} as Record<SectionKey, SectionDiff>;
  let hasChanges = false;
  for (const key of SECTION_KEYS) {
    const d = diffSection(savedByKey[key], fresh[key] ?? "");
    sections[key] = d;
    if (d.newBullets.length > 0) hasChanges = true;
  }

  return { hasChanges, sections };
}
