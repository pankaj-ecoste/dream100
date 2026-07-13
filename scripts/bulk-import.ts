// One-time resumable Zoho bulk import. Pulls every active-stage deal
// (and its parent account) into Supabase, ~2,000 records per plan.md
// §4.4. Run from a developer laptop — NEVER on Vercel, whose
// serverless functions time out long before ~2k records finish.
//
// Usage: npm run bulk-import
//
// Resumable: progress is saved to sync_state after every page. If
// this crashes (network blip, Zoho rate limit, laptop sleeps), just
// re-run it — it picks up from the last saved page instead of
// starting over. Upserts are idempotent (ON CONFLICT on
// crm_record_id), so redoing the last page on resume is safe, not
// duplicative.
//
// PRODUCTION DEBUG MAP: if this script fails partway, check
// sync_state.error for module = 'bulk_import' — that's the exact
// page and Zoho error it stopped on.
import { syncActiveDealsPage } from "../lib/zoho";
import { createAdminClient } from "../lib/supabase/admin";

const PAGE_SIZE = 200; // Zoho COQL's per-request cap
const MODULE = "bulk_import";

async function getResumePoint(): Promise<number> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("sync_state")
    .select("last_page")
    .eq("module", MODULE)
    .maybeSingle();
  return data?.last_page ?? 0;
}

async function saveProgress(page: number, status: "running" | "ok" | "error", error?: string) {
  const supabase = createAdminClient();
  const now = new Date().toISOString();
  const { error: dbError } = await supabase.from("sync_state").upsert(
    {
      module: MODULE,
      last_page: page,
      last_run_at: now,
      last_success_at: status === "error" ? undefined : now,
      status,
      error: error ?? null,
    },
    { onConflict: "module" }
  );
  if (dbError) {
    console.error("Failed to save sync_state progress (import itself may still be fine):", dbError.message);
  }
}

async function main() {
  let page = await getResumePoint();
  console.log(`Starting bulk import from page ${page} (offset ${page * PAGE_SIZE}, page size ${PAGE_SIZE})`);

  let totalDeals = 0;
  let totalAccountUpserts = 0;

  try {
    for (;;) {
      const offset = page * PAGE_SIZE;
      process.stdout.write(`Page ${page} (offset ${offset})... `);

      const result = await syncActiveDealsPage(PAGE_SIZE, offset);
      totalDeals += result.dealsProcessed;
      totalAccountUpserts += result.accountsProcessed;

      console.log(`${result.dealsProcessed} deals, ${result.accountsProcessed} accounts.`);

      await saveProgress(page, "running");

      if (!result.hasMore) break;
      page++;
    }

    await saveProgress(page, "ok");
    console.log(
      `\nDone. ${totalDeals} deals processed, ${totalAccountUpserts} account upserts across ${page + 1} page(s).`
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\nFAILED on page ${page}: ${message}`);
    await saveProgress(page, "error", message);
    console.error("Fix the issue and re-run `npm run bulk-import` — it will resume from this page.");
    process.exit(1);
  }
}

main();
