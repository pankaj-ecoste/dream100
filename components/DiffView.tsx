"use client";
// Phase 4 — the repeat-visit surface. Two jobs, both driven by props
// from components/Chat.tsx:
//
//   1. Show the SAVED picture instantly. On opening a client we've
//      researched before, last time's analysis + four sections are in
//      hand from the server render (client/[id]/page.tsx) — no AI call,
//      no wait. This is the §9 Phase 4 "<2s stored picture" metric. The
//      analysis (how to approach) is the headline; the four sections sit
//      behind a "show details" toggle so the phone screen stays scannable.
//
//   2. Show WHAT CHANGED after a re-run. The comparison narration streams
//      in as a `delta target:comparison` (lib/agent.ts runComparison) and
//      renders here, above the saved picture — it's the most actionable
//      thing on a repeat visit.
//
// This component decides NOTHING about what changed; lib/diff.ts + the
// COMPARISON prompt already did. It only renders the text it's handed.
import { useState } from "react";
import { formatDate } from "@/lib/format";
import AgentText from "./AgentText";
import FindingsSection from "./FindingsSection";

export type SavedPicture = {
  linkedin_findings: string | null;
  rera_findings: string | null;
  website_findings: string | null;
  news_findings: string | null;
  final_analysis: string | null;
  updated_at: string;
};

const SAVED_SECTIONS: {
  key: keyof SavedPicture;
  title: string;
}[] = [
  { key: "linkedin_findings", title: "People" },
  { key: "rera_findings", title: "RERA & Projects" },
  { key: "website_findings", title: "Website" },
  { key: "news_findings", title: "News" },
];

export default function DiffView({
  saved,
  comparison,
  comparisonStreaming,
}: {
  saved: SavedPicture;
  comparison: string;
  comparisonStreaming: boolean;
}) {
  const [showDetails, setShowDetails] = useState(false);

  return (
    <div>
      {/* ── What's changed (only after a re-run) ── */}
      {comparison && (
        <section className="mt-4 rounded-2xl border-2 border-brand-green/30 bg-brand-green/5 p-6 shadow-sm">
          <AgentText text={comparison} />
          {comparisonStreaming && (
            <span className="mt-1 inline-block h-4 w-2 animate-pulse rounded-sm bg-brand-green/50" />
          )}
        </section>
      )}

      {/* ── The saved picture, available instantly ── */}
      <section className="mt-4 rounded-2xl bg-white p-6 shadow-sm">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="text-base font-semibold text-brand-blue-dark">
            Last saved research
          </h2>
          <span className="shrink-0 text-xs text-zinc-400">
            {formatDate(saved.updated_at)}
          </span>
        </div>

        {saved.final_analysis ? (
          <AgentText text={saved.final_analysis} />
        ) : (
          <p className="text-sm text-zinc-400">
            No saved analysis — only section findings below.
          </p>
        )}

        <button
          type="button"
          onClick={() => setShowDetails((v) => !v)}
          className="mt-4 text-xs font-semibold text-brand-blue underline underline-offset-2"
        >
          {showDetails ? "Hide saved details" : "Show saved details"}
        </button>
      </section>

      {/* Saved section cards, revealed on demand. */}
      {showDetails &&
        SAVED_SECTIONS.map(({ key, title }) => {
          const text = saved[key] as string | null;
          if (!text) return null;
          return (
            <FindingsSection
              key={key}
              title={`${title} — saved`}
              text={text}
              final
              dropped={0}
            />
          );
        })}
    </div>
  );
}
