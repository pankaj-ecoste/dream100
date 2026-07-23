// POST /api/account/verify — step 2 of account setup: the person
// enters the code emailed by step 1 (/api/account/activate). Verifying
// confirms their email (Supabase marks email_confirmed_at) AND signs
// them in — the session cookie set here is what gets them straight
// into the app afterward. Pre-auth by design; see proxy.ts.
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const bodySchema = z.object({
  email: z.string().email(),
  code: z.string().min(1),
});

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const { email, code } = parsed.data;

  // Cookie-aware client — verifyOtp's session gets written straight to
  // the response cookies here, same mechanism proxy.ts/server.ts use.
  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ email, token: code, type: "email" });

  if (error) {
    return NextResponse.json({ error: "That code is incorrect or expired." }, { status: 400 });
  }

  // Setup is complete — this person no longer needs to appear in the
  // name picker. Best-effort: if this fails, it's a harmless leftover
  // row (createUser is already idempotent-safe for a retry), not
  // something worth failing the whole request over.
  const admin = createAdminClient();
  await admin.from("pending_users").delete().eq("email", email);

  return NextResponse.json({ ok: true });
}
