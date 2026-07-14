-- ════════════════════════════════════════════════════════════════════
-- Dream 100 — Migration 005: deal-level note attribution
-- Additive only. Today interactions only know their ACCOUNT — a note
-- logged against a Deal in Zoho gets resolved up to that deal's parent
-- account and the specific deal is forgotten (see syncNotesForParentBatch
-- in lib/zoho.ts). This adds a nullable deal_id so the new opportunity
-- detail screen (Phase 2) can show a deal's own conversation history,
-- not just the whole account's. Existing rows stay deal_id = null until
-- `npm run sync-notes` is re-run (idempotent — upserts on crm_note_id).
-- ════════════════════════════════════════════════════════════════════

alter table public.interactions
  add column deal_id uuid references public.deals (id);

create index interactions_deal_idx
  on public.interactions (deal_id, meeting_date desc);

-- No RLS policy change needed: interactions_select (migration 002)
-- already gates on account_id via the accounts table, and every row
-- with a deal_id also carries the matching account_id.
