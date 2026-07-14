// Search — a SERVER component. Reads the query from the `searchParams`
// prop (a Promise in Next 16) rather than the client `useSearchParams`
// hook, so the whole page renders on the server with zero client JS:
// fastest possible search on a phone on 4G (Phase 2 exit metric: cold
// open → search → full record under 3 seconds).
//
// Every query below goes through lib/supabase/server.ts, which carries
// the signed-in user's session — RLS (migration 002's accounts_select
// policy) does the actual access filtering. This page never filters by
// assigned_user_id itself; it just asks Postgres "what can this user
// see", same as every other screen.
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import SearchBar from "@/components/SearchBar";
import { formatSyncedAt } from "@/lib/format";

const RESULT_LIMIT = 50;

// PostgREST's .or() filter string uses `,` `(` `)` as syntax — strip them
// from user input so a stray character in a search box can never break
// the query. `%` and `_` are SQL ILIKE wildcards; escaping them keeps
// search literal (typing "50%" searches for the text "50%", not a
// wildcard match).
function sanitizeSearchTerm(raw: string): string {
  return raw
    .replace(/[,()]/g, "")
    .replace(/[%_]/g, (char) => `\\${char}`)
    .trim();
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const query = q?.trim() ?? "";

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

  let accountsQuery = supabase
    .from("accounts")
    .select("id, name, city, industry, synced_at")
    .order("synced_at", { ascending: false, nullsFirst: false })
    .limit(RESULT_LIMIT);

  if (query) {
    const term = sanitizeSearchTerm(query);
    accountsQuery = accountsQuery.or(`name.ilike.%${term}%,city.ilike.%${term}%`);
  }

  const { data: accounts, error } = await accountsQuery;

  return (
    <main className="mx-auto min-h-dvh w-full max-w-md bg-zinc-50 px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-zinc-900">Dream 100</h1>
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

      <SearchBar defaultValue={query} />

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          Could not load clients: {error.message}
        </p>
      )}

      {!error && accounts && accounts.length === 0 && (
        <p className="mt-8 text-center text-sm text-zinc-400">
          {query
            ? "No matching clients found."
            : "No clients assigned to you yet."}
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
              <span className="shrink-0 whitespace-nowrap text-xs text-zinc-400">
                {formatSyncedAt(account.synced_at)}
              </span>
            </div>
            <p className="mt-0.5 text-sm text-zinc-500">
              {[account.city, account.industry].filter(Boolean).join(" · ") || "—"}
            </p>
          </Link>
        ))}
      </div>
    </main>
  );
}
