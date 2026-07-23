// Runs BEFORE every matched request (like Django middleware).
// Next.js 16 calls this file "proxy" — older tutorials say "middleware.ts";
// same concept, new name.
// Two jobs:
//   1. Refresh the Supabase auth session cookie so logins don't
//      silently expire mid-use.
//   2. Bounce anyone not logged in to /login.
//
// PRODUCTION DEBUG MAP: "users keep getting logged out" or
// "redirect loop on /login" → this file.
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANT: getUser() validates the JWT against Supabase servers.
  // Do not swap for getSession() here — that only reads the cookie
  // and can be spoofed.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  // /api/account/* runs before a session exists (account setup) — same
  // reasoning as /login itself.
  const isPublic =
    path.startsWith("/login") || path.startsWith("/auth") || path.startsWith("/api/account");

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  // Which requests this middleware runs on. Everything EXCEPT:
  //  - /api/zoho/*  → Zoho's webhook + Vercel cron have no browser session;
  //                   they authenticate with secrets inside the route itself
  //  - Next.js internals and static files
  matcher: [
    "/((?!api/zoho|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
