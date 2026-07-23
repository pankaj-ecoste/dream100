// Search — a SERVER component. Reads the query from the `searchParams`
// prop (a Promise in Next 16) rather than the client `useSearchParams`
// hook, so the whole page renders on the server with zero client JS:
// fastest possible search on a phone on 4G (Phase 2 exit metric: cold
// open → search → full record under 3 seconds).
//
// Every query below goes through lib/supabase/server.ts, which carries
// the signed-in user's session. As of migration 006 (V2 Phase 0),
// accounts_select just requires being authenticated — visibility is
// company-wide, narrowed only by the Industry/Stage filters below, not
// by who's signed in.
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import SearchBar from "@/components/SearchBar";
import { formatSyncedAt } from "@/lib/format";
import { ACTIVE_DEAL_STAGES } from "@/lib/zoho";
import { industryGroup, GHB_CUSTOMER_TAG, GHB_PROSPECT_TAG, GHB_PROSPECT_STAGES } from "@/lib/industryGroups";

const RESULT_LIMIT = 50;

// V2 Phase 0: resolves the ad-hoc `stage` search param (the general
// Stage dropdown — independent of the GHB presets below) into a real
// deals.stage value. Unrecognized values are ignored, not errored.
function resolveStageValues(stageParam: string): string[] | null {
  if ((ACTIVE_DEAL_STAGES as readonly string[]).includes(stageParam)) return [stageParam];
  return null;
}

// V2 Phase 0: the two named presets — TAG *and* STAGE together, per the
// owner's exact definition (2026-07-23): GHB Customer = the "D- 100 GHB
// Customers" account tag AND a deal at the Order Punched stage; GHB
// Prospect = the "D- 100 GHB Prospects" tag AND a deal at any of the 5
// active stages. The tag alone isn't enough — e.g. a "GHB Customers"
// tagged account can also carry old Deal Lost / other-stage deals
// (confirmed live: 161 tagged accounts have 1,530 deals total across
// many stages, only 740 of them actually Order Punched), so the stage
// condition is what actually pins down "is this account presently a
// customer/prospect", same as the report the owner built this against.
function resolveTagFilter(tagParam: string): { tag: string; stages: string[] } | null {
  if (tagParam === "ghb_customer") return { tag: GHB_CUSTOMER_TAG, stages: ["Order Punched"] };
  if (tagParam === "ghb_prospect") return { tag: GHB_PROSPECT_TAG, stages: [...GHB_PROSPECT_STAGES] };
  return null;
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ industry?: string; stage?: string; tag?: string; page?: string }>;
}) {
  const { industry, stage, tag, page } = await searchParams;
  const industryFilter = industry?.trim() ?? "";
  const stageFilter = stage?.trim() ?? "";
  const tagFilter = tag?.trim() ?? "";
  const pageNum = Math.max(1, parseInt(page ?? "1", 10) || 1);
  const rangeFrom = (pageNum - 1) * RESULT_LIMIT;
  const rangeTo = rangeFrom + RESULT_LIMIT - 1;

  const supabase = await createClient();

  // Who's actually signed in — shown in the header so a salesperson can
  // confirm at a glance which account they're using (matters once more
  // than one real person is testing/using this).
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from("users")
    .select("full_name")
    .eq("id", user!.id)
    .single();

  // V2 Phase 0: Stage filter — an account matches if ANY of its deals
  // are at the resolved stage(s). Uses a PostgREST embedded-join filter
  // (deals!inner) rather than "fetch matching account ids, then
  // .in('id', ids)" — the two-step version was tried first and breaks
  // once a stage matches hundreds of accounts: a several-hundred-item
  // IN list triggers a 400 Bad Request (confirmed live against
  // production data, e.g. "4 Phase" alone matches 600 accounts). The
  // embedded-join filter does the whole thing in one request and never
  // builds a giant list. deals!inner(id) doesn't duplicate account rows
  // even when multiple of an account's deals match — PostgREST nests
  // matching child rows under each parent instead of fanning out.
  // A tag preset (below) always carries its own required stage list, so
  // it forces the same deals!inner join the ad-hoc Stage dropdown uses —
  // whichever one is active decides the effective stage filter; a tag
  // preset takes precedence since its stage requirement is part of its
  // definition, not an independent, freely-combinable control.
  const resolvedTagFilter = tagFilter ? resolveTagFilter(tagFilter) : null;
  const adHocStageValues = stageFilter ? resolveStageValues(stageFilter) : null;
  const stageValues = resolvedTagFilter ? resolvedTagFilter.stages : adHocStageValues;

  const group = industryGroup(industryFilter);

  // Supabase's query builder parses .select()'s argument as a string
  // literal type for row-shape inference, so the two shapes need two
  // literal calls rather than one call fed a runtime-computed string.
  let accountsQuery = (
    stageValues
      ? supabase.from("accounts").select("id, name, city, industry, synced_at, deals!inner(id)")
      : supabase.from("accounts").select("id, name, city, industry, synced_at")
  )
    .order("synced_at", { ascending: false, nullsFirst: false })
    .range(rangeFrom, rangeTo);

  let accountsCountQuery = (
    stageValues
      ? supabase.from("accounts").select("id, deals!inner(id)", { count: "exact", head: true })
      : supabase.from("accounts").select("id", { count: "exact", head: true })
  );

  // V2 Phase 0: GHB (Customer)/(Prospect) presets — real tag match via
  // the GIN-indexed dream100_tags array (migration 007) COMBINED with
  // the stage condition above, not tag alone (see resolveTagFilter).
  if (resolvedTagFilter) {
    accountsQuery = accountsQuery.contains("dream100_tags", [resolvedTagFilter.tag]);
    accountsCountQuery = accountsCountQuery.contains("dream100_tags", [resolvedTagFilter.tag]);
  }

  // V2 Phase 0: Industry filter — company-wide, no owner/salesperson
  // scoping (migration 006). "Institutional / Other" also matches a
  // null accounts.industry, so it needs an .or() rather than a plain
  // .in(); every other group is a plain IN list.
  if (group) {
    if (group.includeNull) {
      const csv = group.rawValues.map((v) => `"${v.replace(/"/g, '\\"')}"`).join(",");
      accountsQuery = accountsQuery.or(`industry.in.(${csv}),industry.is.null`);
      accountsCountQuery = accountsCountQuery.or(`industry.in.(${csv}),industry.is.null`);
    } else {
      accountsQuery = accountsQuery.in("industry", group.rawValues);
      accountsCountQuery = accountsCountQuery.in("industry", group.rawValues);
    }
  }

  if (stageValues) {
    accountsQuery = accountsQuery.in("deals.stage", stageValues);
    accountsCountQuery = accountsCountQuery.in("deals.stage", stageValues);
  }

  // Deal count for the SAME filter combination — anchored on the deals
  // table (not accounts) so it counts every matching deal across all
  // matching accounts, not just the accounts rendered on this page
  // (RESULT_LIMIT caps the list to 50, but the count must reflect the
  // true total, e.g. GHB Prospect = 837 deals even though only 50
  // accounts are shown).
  let dealsCountQuery = supabase.from("deals").select("id, accounts!inner(id)", { count: "exact", head: true });
  if (resolvedTagFilter) {
    dealsCountQuery = dealsCountQuery.contains("accounts.dream100_tags", [resolvedTagFilter.tag]);
  }
  if (group) {
    if (group.includeNull) {
      const csv = group.rawValues.map((v) => `"${v.replace(/"/g, '\\"')}"`).join(",");
      // referencedTable, not a manually-prefixed "accounts.industry"
      // string — confirmed live that the manual-prefix version silently
      // fails on an embedded-table .or() (empty error message, count null).
      dealsCountQuery = dealsCountQuery.or(`industry.in.(${csv}),industry.is.null`, { referencedTable: "accounts" });
    } else {
      dealsCountQuery = dealsCountQuery.in("accounts.industry", group.rawValues);
    }
  }
  if (stageValues) {
    dealsCountQuery = dealsCountQuery.in("stage", stageValues);
  }

  const [{ data: accounts, error }, { count: accountCount }, { count: dealCount }] = await Promise.all([
    accountsQuery,
    accountsCountQuery,
    dealsCountQuery,
  ]);

  const hasActiveFilter = Boolean(industryFilter || stageFilter || tagFilter);
  const totalPages = Math.max(1, Math.ceil((accountCount ?? 0) / RESULT_LIMIT));

  // Preserves the active filters across Previous/Next — a plain <Link>,
  // no JS needed, consistent with the rest of this zero-JS page.
  function pageHref(targetPage: number): string {
    const params = new URLSearchParams();
    if (industryFilter) params.set("industry", industryFilter);
    if (stageFilter) params.set("stage", stageFilter);
    if (tagFilter) params.set("tag", tagFilter);
    if (targetPage > 1) params.set("page", String(targetPage));
    const qs = params.toString();
    return qs ? `/?${qs}` : "/";
  }

  return (
    <main className="mx-auto min-h-dvh w-full max-w-md bg-zinc-50 px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-brand-blue-dark">Dream 100</h1>
          <p className="text-sm text-zinc-500">{profile?.full_name ?? user!.email}</p>
        </div>
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600"
          >
            Sign out
          </button>
        </form>
      </div>

      <SearchBar
        stageOptions={ACTIVE_DEAL_STAGES}
        selectedIndustry={industryFilter}
        selectedStage={stageFilter}
        selectedTag={tagFilter}
      />

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          Could not load clients: {error.message}
        </p>
      )}

      {!error && (
        <p className="mb-3 text-sm text-zinc-500">
          <span className="font-semibold text-zinc-700">{accountCount ?? 0}</span> accounts ·{" "}
          <span className="font-semibold text-zinc-700">{dealCount ?? 0}</span> deals
          {hasActiveFilter ? " matching this filter" : " total"}
        </p>
      )}

      {!error && accounts && accounts.length === 0 && (
        <p className="mt-8 text-center text-sm text-zinc-400">
          {hasActiveFilter ? "No matching clients found." : "No clients found."}
        </p>
      )}

      <div className="space-y-2">
        {accounts?.map((account) => (
          <Link
            key={account.id}
            href={`/client/${account.id}`}
            className="block rounded-xl bg-white p-4 shadow-sm active:bg-zinc-100"
          >
            <div className="flex items-start justify-between gap-3">
              <p className="font-semibold text-zinc-900">{account.name}</p>
              <span className="shrink-0 whitespace-nowrap rounded-full bg-brand-green/10 px-2 py-0.5 text-xs font-medium text-brand-green-dark">
                {formatSyncedAt(account.synced_at)}
              </span>
            </div>
            <p className="mt-0.5 text-sm text-zinc-500">
              {[account.city, account.industry].filter(Boolean).join(" · ") || "—"}
            </p>
          </Link>
        ))}
      </div>

      {!error && totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between gap-3">
          {pageNum > 1 ? (
            <Link
              href={pageHref(pageNum - 1)}
              className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700"
            >
              ← Previous
            </Link>
          ) : (
            <span />
          )}

          <span className="text-xs text-zinc-400">
            Page {pageNum} of {totalPages}
          </span>

          {pageNum < totalPages ? (
            <Link
              href={pageHref(pageNum + 1)}
              className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700"
            >
              Next →
            </Link>
          ) : (
            <span />
          )}
        </div>
      )}
    </main>
  );
}
