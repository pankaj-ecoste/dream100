// POST /api/account/activate — step 1 of account setup: the person has
// picked their name (a pending_users row, added by the owner via the
// SQL Editor) and chosen a password. This creates their real
// auth.users row (unconfirmed) and emails a one-time code — step 2 is
// /api/account/verify. Pre-auth by design (no session exists yet);
// see proxy.ts's isPublic check.
//
// PRODUCTION DEBUG MAP: "can't set up account" / "no code arrived" →
// this file. "code doesn't work" → app/api/account/verify/route.ts.
import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  pendingUserId: z.string().uuid(),
  password: z.string().min(8),
});

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const { pendingUserId, password } = parsed.data;

  const admin = createAdminClient();

  // Never trust a client-supplied email — pendingUserId is the only
  // input, and it must match a row the owner actually added.
  const { data: pending, error: lookupError } = await admin
    .from("pending_users")
    .select("email, full_name")
    .eq("id", pendingUserId)
    .maybeSingle();

  if (lookupError || !pending) {
    return NextResponse.json({ error: "That name wasn't found. Ask the owner to check it was added." }, { status: 404 });
  }

  // Create the real auth user, unconfirmed. If a previous attempt got
  // this far but the person never finished step 2, the email already
  // exists — that's fine, just move on to (re)sending the code rather
  // than erroring, since retrying setup is a normal thing to do.
  const { error: createError } = await admin.auth.admin.createUser({
    email: pending.email,
    password,
    email_confirm: false,
    user_metadata: { full_name: pending.full_name },
  });

  if (createError && !createError.message.toLowerCase().includes("already been registered")) {
    console.error("account activate: createUser FAILED:", createError.message);
    return NextResponse.json({ error: createError.message }, { status: 500 });
  }

  // Send the one-time code. Uses the anon-keyed, cookie-aware server
  // client (not admin) — this is the same client a real user-facing
  // auth call would use; no session exists yet so nothing to persist.
  const supabase = await createClient();
  const { error: otpError } = await supabase.auth.signInWithOtp({
    email: pending.email,
    options: { shouldCreateUser: false },
  });

  if (otpError) {
    console.error("account activate: signInWithOtp FAILED:", otpError.message);
    return NextResponse.json({ error: otpError.message }, { status: 500 });
  }

  return NextResponse.json({ email: pending.email });
}
