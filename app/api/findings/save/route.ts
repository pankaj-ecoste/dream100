// Save-on-consent: writes the freshly researched picture into
// client_findings (one row per account, updated in place). The BEFORE
// UPDATE trigger on that table (migration 002) archives the previous
// row into findings_history automatically — this route never touches
// history itself, and Phase 4's comparison feature reads it back.
//
// Deliberately a human-tapped route, NOT a Claude tool: a model-invoked
// write would bypass the user's consent (plan.md §6.3 step 9 — "save?"
// is the salesperson's decision).
//
// Trust chain: session user via the RLS client, then an RLS-scoped read
// of the account AS the authorization check, and only then the admin
// write (client_findings has no user INSERT/UPDATE policies by design —
// the service role writes, stamped with saved_by).
//
// PRODUCTION DEBUG MAP: "save button fails" → this file + Vercel logs;
// "history has duplicate/missing rows" → the archive_findings trigger
// in migration 002, not app code.
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const saveBodySchema = z.object({
  accountId: z.uuid(),
  linkedin: z.string().max(12_000),
  rera: z.string().max(12_000),
  website: z.string().max(12_000),
  news: z.string().max(16_000),
  analysis: z.string().max(16_000),
});

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsed = saveBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }
  const body = parsed.data;

  // Saving five empty sections would overwrite a real saved picture
  // with nothing — refuse.
  if (
    [body.linkedin, body.rera, body.website, body.news, body.analysis].every(
      (t) => t.trim() === ""
    )
  ) {
    return NextResponse.json({ error: "nothing to save" }, { status: 400 });
  }

  // RLS gate: can this salesperson see this account? (The admin write
  // below bypasses RLS — this read IS the authorization.)
  const { data: account } = await supabase
    .from("accounts")
    .select("id")
    .eq("id", body.accountId)
    .maybeSingle();
  if (!account) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const savedAt = new Date().toISOString();
  const { error } = await createAdminClient()
    .from("client_findings")
    .upsert(
      {
        account_id: body.accountId,
        linkedin_findings: body.linkedin,
        rera_findings: body.rera,
        website_findings: body.website,
        news_findings: body.news,
        final_analysis: body.analysis,
        saved_by: user.id,
        updated_at: savedAt,
      },
      { onConflict: "account_id" }
    );

  if (error) {
    console.error("findings save FAILED:", body.accountId, error);
    return NextResponse.json({ error: "save failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, savedAt });
}
