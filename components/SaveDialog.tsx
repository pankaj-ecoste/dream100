"use client";
// The "save this research?" consent step at the end of a run (plan.md
// §6.3 step 9). Saving replaces the client's stored picture (the DB
// trigger archives the old one for Phase 4's comparison), so it asks
// once, explicitly, instead of auto-saving.
import { useState } from "react";
import type { SectionTexts } from "@/lib/agent"; // type-only: erased at build

type SaveState = "idle" | "confirming" | "saving" | "saved" | "error";

export default function SaveDialog({
  accountId,
  sections,
  previouslySavedAt,
}: {
  accountId: string;
  sections: SectionTexts;
  previouslySavedAt: string | null;
}) {
  const [state, setState] = useState<SaveState>("idle");

  async function save() {
    setState("saving");
    const res = await fetch("/api/findings/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId, ...sections }),
    }).catch(() => null);
    setState(res?.ok ? "saved" : "error");
  }

  if (state === "saved") {
    return (
      <p className="rounded-lg bg-brand-green/10 px-3 py-2 text-sm font-medium text-brand-green-dark">
        Saved — next visit starts from this picture.
      </p>
    );
  }

  if (state === "confirming" || state === "saving" || state === "error") {
    return (
      <div className="rounded-lg bg-zinc-50 px-3 py-3 text-sm">
        <p className="text-zinc-700">
          Save these findings?
          {previouslySavedAt
            ? " They replace the currently saved picture (the old one is kept for comparison)."
            : " They become this client's saved picture."}
        </p>
        {state === "error" && (
          <p className="mt-1 text-red-700">Save failed — try again.</p>
        )}
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={save}
            disabled={state === "saving"}
            className="rounded-lg bg-brand-green px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-green-dark disabled:opacity-50"
          >
            {state === "saving" ? "Saving…" : "Yes, save"}
          </button>
          <button
            type="button"
            onClick={() => setState("idle")}
            disabled={state === "saving"}
            className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-500 hover:bg-zinc-100"
          >
            Not now
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setState("confirming")}
      className="w-full rounded-lg border border-brand-green bg-white py-2.5 text-sm font-semibold text-brand-green-dark transition-colors hover:bg-brand-green/10"
    >
      Save this research
    </button>
  );
}
