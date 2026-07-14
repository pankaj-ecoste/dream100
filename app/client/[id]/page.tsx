// Client record — the screen a salesperson opens 10 minutes before a
// meeting. Server Component; `params` is a Promise in Next 16 (confirmed
// against node_modules/next/dist/docs/.../dynamic-routes.md).
//
// All three queries run through lib/supabase/server.ts (RLS-scoped) and
// fire in parallel — none depends on another, since the route's `id` IS
// accounts.id, the same value every child table's account_id points to.
// If the account doesn't exist OR RLS hides it (not this salesperson's,
// wrong region), the account query comes back empty either way and we
// show the same notFound() — never leaking which case it was.
import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import ClientRecord from "@/components/ClientRecord";
import Timeline from "@/components/Timeline";

const INTERACTIONS_LIMIT = 30;

export default async function ClientPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [accountResult, dealsResult, interactionsResult] = await Promise.all([
    supabase
      .from("accounts")
      .select(
        "name, city, industry, ho_location, vertical, working_status, account_unique_number, synced_at"
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("deals")
      .select("id, name, stage, contact_name, mobile, cities, amount")
      .eq("account_id", id),
    supabase
      .from("interactions")
      .select("id, meeting_date, kind, content")
      .eq("account_id", id)
      .order("meeting_date", { ascending: false, nullsFirst: false })
      .limit(INTERACTIONS_LIMIT),
  ]);

  // A malformed :id (not a UUID) or an RLS-hidden/missing account both
  // land here — either way, "not found" is the correct, non-leaking response.
  if (accountResult.error || !accountResult.data) {
    notFound();
  }

  return (
    <main className="mx-auto min-h-dvh w-full max-w-md bg-zinc-50 px-4 py-8">
      <Link href="/" className="mb-4 inline-block text-sm text-zinc-500">
        ← Back to search
      </Link>

      <ClientRecord
        accountId={id}
        account={accountResult.data}
        deals={dealsResult.data ?? []}
      />
      <Timeline interactions={interactionsResult.data ?? []} />
    </main>
  );
}
