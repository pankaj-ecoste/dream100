// Service-role Supabase client — BYPASSES RLS ENTIRELY.
// Only for trusted server paths that act on behalf of the SYSTEM, not
// a user: the Zoho webhook, nightly cron, bulk import, findings save.
//
// Rules:
//   1. Never import this in a file that has "use client" anywhere near it.
//   2. Never pass its data to the browser without checking the user's
//      session first — RLS is not protecting you here, YOU are.
//
// PRODUCTION DEBUG MAP: if data appears that a user shouldn't see,
// the leak is in a route that used this client — start the hunt here.
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    }
  );
}
