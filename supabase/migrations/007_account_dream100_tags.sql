-- ════════════════════════════════════════════════════════════════════
-- Dream 100 — Migration 007: account-level Dream100 tags (V2 Phase 0)
--
-- What this is: Zoho has a hand-curated Prospect/Customer tagging
-- system on Accounts (e.g. "D- 100 GHB Customers", "D- 100 GHB
-- Prospects", plus equivalents for Private Contractor, Institutional,
-- Fabricator, Govt Contractor, Reseller, Dealer, Architects, etc.) —
-- confirmed live 2026-07-23 via Zoho's Accounts module `Tag` field.
-- This IS the real "Dream 100" segmentation the product is named
-- after — not something to reconstruct from Industry+Stage.
--
-- Why it needed a new OAuth scope: reading tag data required adding
-- ZohoCRM.settings.tags.READ to the Self Client (previously missing —
-- confirmed via a live 401 OAUTH_SCOPE_MISMATCH on the dedicated tags
-- endpoint). Also: COQL cannot select "Tag" at all (confirmed:
-- SYNTAX_ERROR) — only the plain REST list/get endpoints return it, and
-- only for the Accounts module (Deals carries different, unrelated
-- tags like "Repeat Order"). So this column is populated by a separate
-- REST batch fetch (lib/zoho.ts: fetchAccountTagsByIds /
-- attachDream100Tags), not by the existing COQL-based account queries.
--
-- Stores ALL of an account's tags (not just GHB) as plain names, so
-- adding another segment later (Private Contractor, Institutional,
-- etc.) is a query-side change only — no new column, no re-sync.
-- ════════════════════════════════════════════════════════════════════

alter table public.accounts
  add column dream100_tags text[] not null default '{}';

create index accounts_dream100_tags_idx
  on public.accounts using gin (dream100_tags);
