// POST /auth/signout — kills the session cookie and bounces to /login.
// A route.ts file = pure backend endpoint, no UI (like a FastAPI route).
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", request.url), {
    status: 302,
  });
}
