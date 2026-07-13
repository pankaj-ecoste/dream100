// Server-side Supabase client (Server Components + API routes).
// Reads the user's session from the request COOKIES — so just like the
// browser client, it acts AS the logged-in user and RLS applies.
// Use this for anything answering a user request (search, client screen,
// chat route). It is NOT for the webhook/cron — those use admin.ts.
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component where cookies are read-only.
            // Safe to ignore: middleware.ts refreshes the session instead.
          }
        },
      },
    }
  );
}
