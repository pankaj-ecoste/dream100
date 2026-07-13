// Weekly reconciliation: the one sync path that catches DELETES. The
// webhook and nightly cron only ever see creates/edits (Zoho doesn't
// fire workflow rules on delete, and a deleted record has no
// Modified_Time left to find) — this walks Zoho's deleted-records log
// instead and soft-archives any account we're still holding as live.
// Triggered by Vercel's scheduler (vercel.json, Sunday) — same
// Authorization: Bearer <CRON_SECRET> auth as the nightly route.
//
// PRODUCTION DEBUG MAP: "an account deleted in Zoho still shows up
// here" → check sync_state where module = 'reconcile' first, then
// lib/zoho.ts's reconcileDeletedAccounts.
import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { reconcileDeletedAccounts } from "@/lib/zoho";

export const maxDuration = 300;

const MODULE = "reconcile";

function isAuthorized(request: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : header;
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  if (providedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(providedBuf, expectedBuf);
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const startedAt = new Date().toISOString();

  await supabase
    .from("sync_state")
    .upsert({ module: MODULE, last_run_at: startedAt, status: "running" }, { onConflict: "module" });

  try {
    const { deletedIdsSeen, archived } = await reconcileDeletedAccounts();

    await supabase
      .from("sync_state")
      .upsert(
        { module: MODULE, last_run_at: startedAt, last_success_at: new Date().toISOString(), status: "ok", error: null },
        { onConflict: "module" }
      );

    return NextResponse.json({ ok: true, deletedIdsSeen, archived });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Reconciliation cron FAILED:", message);
    await supabase
      .from("sync_state")
      .upsert({ module: MODULE, last_run_at: startedAt, status: "error", error: message }, { onConflict: "module" });

    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
