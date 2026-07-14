"use client";
// 👍/👎 on an agent run — the earliest alarm of prompt drift (plan.md
// §13: "falling ratio is reviewed weekly"). Writes straight from the
// browser to research_logs.feedback: the RLS policy research_logs_feedback
// only lets a user UPDATE feedback on their OWN rows, so no API route is
// needed — the database is the authorization layer, same as everywhere
// else in this app.
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function FeedbackButtons({ runId }: { runId: string }) {
  const [choice, setChoice] = useState<1 | -1 | null>(null);

  async function give(value: 1 | -1) {
    setChoice(value); // optimistic — a lost feedback write is not worth an error box
    const supabase = createClient();
    await supabase.from("research_logs").update({ feedback: value }).eq("id", runId);
  }

  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-zinc-500">Was this useful?</span>
      <button
        type="button"
        onClick={() => give(1)}
        aria-label="Thumbs up"
        className={`rounded-full px-2.5 py-1 text-sm transition-colors ${
          choice === 1 ? "bg-brand-green/15" : "hover:bg-zinc-100"
        }`}
      >
        👍
      </button>
      <button
        type="button"
        onClick={() => give(-1)}
        aria-label="Thumbs down"
        className={`rounded-full px-2.5 py-1 text-sm transition-colors ${
          choice === -1 ? "bg-red-100" : "hover:bg-zinc-100"
        }`}
      >
        👎
      </button>
    </div>
  );
}
