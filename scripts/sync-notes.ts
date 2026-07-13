// Syncs Notes (meeting/call history) for every currently-synced account
// and deal into the interactions table. Run after bulk-import.ts has
// populated accounts/deals — Notes sync depends on those being present
// to resolve Parent_Id -> account_id.
//
// Usage: npm run sync-notes
import { syncAllNotes } from "../lib/zoho";

async function main() {
  console.log("Starting notes sync...");
  const result = await syncAllNotes();
  console.log(`\nDone. ${result.notesProcessed} notes synced, ${result.notesSkipped} skipped.`);
}

main();
