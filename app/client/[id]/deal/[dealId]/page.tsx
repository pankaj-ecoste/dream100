// Opportunity detail — drill-down from the client record screen for a
// single deal. Same pattern as app/client/[id]/page.tsx: Server
// Component, params is a Promise (Next 16), RLS-scoped queries only.
//
// The URL nests dealId under the account's id (/client/:id/deal/:dealId)
// so a mismatched pair (a real deal id under the wrong account id) is
// treated as not-found rather than silently redirecting — RLS already
// guarantees you can't see a deal whose account you can't see, this
// extra .eq() just keeps the URL's own semantics honest.
import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import DealDetail from "@/components/DealDetail";
import Timeline from "@/components/Timeline";

const INTERACTIONS_LIMIT = 30;

export default async function DealPage({
  params,
}: {
  params: Promise<{ id: string; dealId: string }>;
}) {
  const { id, dealId } = await params;
  const supabase = await createClient();

  const [accountResult, dealResult, interactionsResult] = await Promise.all([
    supabase.from("accounts").select("name").eq("id", id).maybeSingle(),
    supabase
      .from("deals")
      .select("name, stage, contact_name, mobile, cities, amount, raw")
      .eq("id", dealId)
      .eq("account_id", id)
      .maybeSingle(),
    supabase
      .from("interactions")
      .select("id, meeting_date, kind, content")
      .eq("deal_id", dealId)
      .order("meeting_date", { ascending: false, nullsFirst: false })
      .limit(INTERACTIONS_LIMIT),
  ]);

  if (accountResult.error || !accountResult.data || dealResult.error || !dealResult.data) {
    notFound();
  }

  return (
    <main className="mx-auto min-h-dvh w-full max-w-md bg-zinc-50 px-4 py-8">
      <Link href={`/client/${id}`} className="mb-4 inline-block text-sm font-medium text-brand-blue">
        ← Back to {accountResult.data.name}
      </Link>

      <DealDetail deal={dealResult.data} />
      <Timeline interactions={interactionsResult.data ?? []} />
    </main>
  );
}
