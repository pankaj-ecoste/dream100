// Nightly cron: heals whatever the webhook missed (workflow rule
// didn't fire, a request failed mid-flight, etc.) by pulling every
// Deal and Account touched since the last successful run. Triggered
// by Vercel's scheduler (vercel.json) at 11 PM IST — Vercel signs
// cron requests with `Authorization: Bearer <CRON_SECRET>` automatically
// when that env var is set, which is the only auth this route needs.
//
// PRODUCTION DEBUG MAP: "sync looks stale" / "an edit from yesterday
// never landed" → check sync_state where module = 'nightly' first
// (status/error/last_success_at tell you exactly where it stopped),
// then lib/zoho.ts's syncModifiedDealsPage/syncModifiedAccountsPage.
import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncModifiedDealsPage, syncModifiedAccountsPage } from "@/lib/zoho";

export const maxDuration = 300;

const MODULE = "nightly";
const PAGE_SIZE = 200;
// First run ever has no watermark to resume from. The bulk import +
// notes sync already cover full historical scope as of 2026-07-09, so
// a short lookback is cheap insurance against the gap between "bulk
// import finished" and "this cron started running" — not the
// mechanism carrying real load.
const FIRST_RUN_LOOKBACK_MS = 2 * 24 * 60 * 60 * 1000;

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

  const { data: state } = await supabase
    .from("sync_state")
    .select("last_success_at")
    .eq("module", MODULE)
    .maybeSingle();

  const since = state?.last_success_at ?? new Date(Date.now() - FIRST_RUN_LOOKBACK_MS).toISOString();

  await supabase
    .from("sync_state")
    .upsert({ module: MODULE, last_run_at: startedAt, status: "running" }, { onConflict: "module" });

  let dealsProcessed = 0;
  let dealsSkipped = 0;
  let dealAccountsProcessed = 0;
  let accountsProcessed = 0;
  let accountsSkipped = 0;

  try {
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const result = await syncModifiedDealsPage(since, PAGE_SIZE, offset);
      dealsProcessed += result.dealsProcessed;
      dealsSkipped += result.dealsSkipped;
      dealAccountsProcessed += result.accountsProcessed;
      if (!result.hasMore) break;
    }

    for (let offset = 0; ; offset += PAGE_SIZE) {
      const result = await syncModifiedAccountsPage(since, PAGE_SIZE, offset);
      accountsProcessed += result.accountsProcessed;
      accountsSkipped += result.accountsSkipped;
      if (!result.hasMore) break;
    }

    await supabase
      .from("sync_state")
      .upsert(
        { module: MODULE, last_run_at: startedAt, last_success_at: new Date().toISOString(), status: "ok", error: null },
        { onConflict: "module" }
      );

    return NextResponse.json({
      ok: true,
      since,
      dealsProcessed,
      dealsSkipped,
      accountsProcessed: dealAccountsProcessed + accountsProcessed,
      accountsSkipped,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Nightly cron FAILED:", message);
    // last_success_at is deliberately NOT advanced — next run retries
    // from the same watermark instead of silently skipping the gap.
    await supabase
      .from("sync_state")
      .upsert({ module: MODULE, last_run_at: startedAt, status: "error", error: message }, { onConflict: "module" });

    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
