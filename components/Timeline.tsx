import { formatDate } from "@/lib/format";

type Interaction = {
  id: string;
  meeting_date: string | null;
  kind: string | null;
  content: string | null;
};

// Rows arrive already sorted newest-first by the caller's query
// (interactions_account_date_idx makes that sort free).
export default function Timeline({ interactions }: { interactions: Interaction[] }) {
  if (interactions.length === 0) {
    return (
      <p className="mt-6 text-sm text-zinc-400">No interactions on file yet.</p>
    );
  }

  return (
    <div className="mt-6">
      <h2 className="mb-2 text-sm font-semibold text-zinc-700">
        Interaction history
      </h2>
      <div className="space-y-3">
        {interactions.map((item) => (
          <div key={item.id} className="rounded-lg bg-zinc-50 p-3 text-sm">
            <div className="mb-1 flex items-center justify-between text-xs text-zinc-500">
              <span>{formatDate(item.meeting_date)}</span>
              <span className="capitalize">{item.kind ?? "note"}</span>
            </div>
            {/* content is plain text — cleanNoteContent() in lib/zoho.ts already
                strips all HTML at sync time, so this is a safe text node. */}
            <p className="whitespace-pre-wrap text-zinc-800">
              {item.content || "(empty note)"}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
