import Link from "next/link";
import { INDUSTRY_GROUPS } from "@/lib/industryGroups";

// No "use client" — a plain <form method="GET"> works without any
// JavaScript. Submitting navigates to `/?industry=...&stage=...`;
// Next.js re-renders app/page.tsx on the server with the new
// searchParams. Fastest possible filtering on a slow phone connection:
// no client bundle, no fetch waterfall, just one navigation.
//
// No free-text search box (owner decision, 2026-07-23 — filters only,
// dropped the name/city search field that used to live here).
export default function SearchBar({
  stageOptions,
  selectedIndustry,
  selectedStage,
  selectedTag,
}: {
  stageOptions: readonly string[];
  selectedIndustry: string;
  selectedStage: string;
  selectedTag: string;
}) {
  const ghbProspectActive = selectedTag === "ghb_prospect";
  const ghbCustomerActive = selectedTag === "ghb_customer";

  return (
    <div className="mb-6 space-y-3">
      <form method="GET" action="/" className="space-y-2">
        <div className="flex gap-2">
          <select
            name="industry"
            defaultValue={selectedIndustry}
            className="w-1/2 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-blue"
          >
            <option value="">Any industry</option>
            {INDUSTRY_GROUPS.map((group) => (
              <option key={group.key} value={group.key}>
                {group.label}
              </option>
            ))}
          </select>

          <select
            name="stage"
            defaultValue={selectedStage}
            className="w-1/2 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-blue"
          >
            <option value="">Any stage</option>
            {stageOptions.map((stage) => (
              <option key={stage} value={stage}>
                {stage}
              </option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          className="w-full rounded-lg bg-brand-blue px-4 py-2 text-sm font-medium text-white active:bg-brand-blue-dark"
        >
          Apply filters
        </button>
      </form>

      <div className="flex gap-2">
        <Link
          href="/?tag=ghb_prospect"
          className={`flex-1 rounded-lg border px-3 py-2 text-center text-sm font-medium ${
            ghbProspectActive
              ? "border-brand-blue bg-brand-blue/10 text-brand-blue-dark"
              : "border-zinc-300 bg-white text-zinc-600"
          }`}
        >
          GHB (Prospect)
        </Link>
        <Link
          href="/?tag=ghb_customer"
          className={`flex-1 rounded-lg border px-3 py-2 text-center text-sm font-medium ${
            ghbCustomerActive
              ? "border-brand-blue bg-brand-blue/10 text-brand-blue-dark"
              : "border-zinc-300 bg-white text-zinc-600"
          }`}
        >
          GHB (Customer)
        </Link>
      </div>
    </div>
  );
}
