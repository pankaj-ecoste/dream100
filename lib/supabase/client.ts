// Browser-side Supabase client.
// Used inside "use client" components (SearchBar, Chat, etc.).
// Carries the logged-in user's session, so every query it makes is
// filtered by RLS — this client CANNOT see other regions' data even
// if our UI code has a bug. That's the whole point of the design.
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
