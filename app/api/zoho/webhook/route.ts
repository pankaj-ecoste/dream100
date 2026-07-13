// Zoho webhook: Zoho's workflow rule posts here on create/edit of an
// Account or Deal. Payload carries only module + record ID — we fetch
// the full record from Zoho ourselves (never trust webhook body data
// directly), guaranteeing we always store complete current truth.
//
// PRODUCTION DEBUG MAP: "a Zoho edit isn't showing up in the app" —
// check here first (is the workflow rule actually firing? is the
// secret correct? check Vercel's function logs for this route), then
// lib/zoho.ts's syncOneAccount/syncOneDeal for the actual sync logic.
//
// No AI work happens on this path — must respond fast so Zoho doesn't
// retry/time out. This route is excluded from proxy.ts's auth gate
// (see its matcher) since Zoho has no browser session; the secret
// below is the only authentication.
import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { syncOneAccount, syncOneDeal } from "@/lib/zoho";

const payloadSchema = z.object({
  module: z.enum(["Accounts", "Deals"]),
  id: z.string().min(1),
});

// Constant-time comparison — a naive `===` leaks how many leading
// characters matched via response-time differences, which matters for
// a secret guarding a public POST endpoint.
function isValidSecret(provided: string | null): boolean {
  const expected = process.env.ZOHO_WEBHOOK_SECRET;
  if (!expected || !provided) return false;
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  if (providedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(providedBuf, expectedBuf);
}

async function handleWebhook(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get("secret");
  if (!isValidSecret(secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Zoho's workflow webhook config can send the payload as a JSON body
  // or bake module/id into the URL as query params (merge fields) with
  // an empty body — support both so the admin has flexibility setting
  // up the workflow rule. In practice Zoho's POST webhooks put
  // parameters in the body in a form we don't control, so the workflow
  // rule is configured to use GET, which forces everything into the URL.
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    // empty/non-JSON body — fall back to query params below
  }

  const candidate = {
    module: (body as Record<string, unknown>)?.module ?? request.nextUrl.searchParams.get("module"),
    id: (body as Record<string, unknown>)?.id ?? request.nextUrl.searchParams.get("id"),
  };

  const parsed = payloadSchema.safeParse(candidate);
  if (!parsed.success) {
    console.error("Zoho webhook: invalid payload", candidate, parsed.error.flatten());
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }

  const { module, id } = parsed.data;

  try {
    const result = module === "Accounts" ? await syncOneAccount(id) : await syncOneDeal(id);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Zoho webhook: sync FAILED for ${module} ${id}:`, message);
    // Still 200 — a 500 makes Zoho retry the same failing record
    // indefinitely, and a single broken record shouldn't retry-storm.
    // The error is logged; systemic failures (dead token, etc.) surface
    // via the nightly cron's own error handling instead.
    return NextResponse.json({ ok: false, error: message }, { status: 200 });
  }
}

export const GET = handleWebhook;
export const POST = handleWebhook;
