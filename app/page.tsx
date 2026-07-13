// Home — a SERVER component (no "use client"): it runs on Vercel, reads
// the session from cookies, and queries the DB as the logged-in user
// (RLS applies). This page is the Phase 0 exit proof: it shows WHO you
// are and WHAT role RLS sees for you.
//
// In Phase 2 this becomes the search screen; for now it's the auth demo.
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createClient();

  // proxy.ts already guaranteed a session exists, so user is non-null here.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // This query passes through RLS: users can only read their own row.
  const { data: profile } = await supabase
    .from("users")
    .select("full_name, role, region")
    .eq("id", user!.id)
    .single();

  return (
    <main className="mx-auto min-h-dvh w-full max-w-md bg-zinc-50 px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold text-zinc-900">Dream 100</h1>
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600"
          >
            Sign out
          </button>
        </form>
      </div>

      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <p className="text-sm text-zinc-500">Signed in as</p>
        <p className="text-lg font-semibold text-zinc-900">{user!.email}</p>

        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-lg bg-zinc-50 p-3">
            <p className="text-zinc-500">Role</p>
            <p className="font-medium text-zinc-900">
              {profile?.role ?? "—"}
            </p>
          </div>
          <div className="rounded-lg bg-zinc-50 p-3">
            <p className="text-zinc-500">Region</p>
            <p className="font-medium text-zinc-900">
              {profile?.region ?? "not set"}
            </p>
          </div>
        </div>

        <p className="mt-6 text-sm text-zinc-400">
          Client search arrives in Phase 2. If you can read this on your
          phone after signing in — Phase 0 works.
        </p>
      </div>
    </main>
  );
}
