// GET /api/account/pending — powers the account-setup screen's name
// picker. Called pre-auth (no session exists yet), same reasoning as
// the old /api/zoho/users: intentionally unauthenticated, and RLS on
// pending_users has no policies at all (migration 008), so this MUST
// use the service-role client — the anon client would just get an
// empty result.
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("pending_users")
    .select("id, full_name")
    .order("full_name");

  if (error) {
    console.error("GET /api/account/pending FAILED:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ users: data });
}
