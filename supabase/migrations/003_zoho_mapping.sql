-- ════════════════════════════════════════════════════════════════════
-- Dream 100 — Migration 003: real Zoho field mapping
-- Additive only — never drop/rename existing columns mid-build.
-- Everything here reflects what was actually confirmed against live
-- Zoho data on 2026-07-09 (see lib/zoho.ts for the field maps).
-- ════════════════════════════════════════════════════════════════════

-- ── accounts: draft-account fix ────────────────────────────────────
-- Draft accounts (not-found flow, is_draft = true) don't have a Zoho
-- ID yet at creation time. NOT NULL as shipped in 001 blocks them.
-- UNIQUE stays — Postgres allows multiple NULLs through a unique index.
alter table public.accounts alter column crm_record_id drop not null;

-- ── accounts: report-derived + Zoho-confirmed columns ──────────────
alter table public.accounts
  add column ho_location          text,   -- Zoho "Location" — head-office locality (free text)
  add column vertical              text,   -- Zoho "Belongs_To" — "Belongs To Which Vertical ?"
  add column working_status         text,   -- Zoho "Account_Working_Status"
  add column account_unique_number  text,   -- Zoho "Account_Unique_Number" (autonumber)
  add column zoho_owner_id           text;  -- Zoho Owner.id — resolved against users.zoho_user_id
                                             --   at sync time to set assigned_user_id. Kept as its
                                             --   own column (not just buried in raw jsonb) so a
                                             --   failed match is visible/queryable directly.

-- accounts.region is intentionally NOT populated by this migration.
-- Zoho's Region/Zone fields are blocked by field-level security as of
-- 2026-07-09 (confirmed: neither COQL nor the REST API can read them
-- for our API profile) — pending a permission fix from the Zoho admin.
-- accounts.city / accounts.lifecycle_stage from 001 are also not fed
-- by this migration: city's source (City_Name) is synced via raw/name
-- flattening in lib/zoho.ts's upsertRecord, and lifecycle_stage has no
-- clean Zoho source (Account_Type turned out to not be COQL-queryable
-- either) — the app's real "is this active" signal turned out to live
-- on Deals.Stage instead, which is what filters what gets synced at all.

-- ── users: Zoho user ID for salesperson matching ───────────────────
-- Decided 2026-07-09: match salespeople by stable Zoho user ID, not
-- free-text name (plan.md's original approach). Signup shows a
-- dropdown of real Zoho users (lib/zoho.ts's getZohoUsers()); the
-- salesperson picks their own name, we store the ID here forever.
alter table public.users
  add column zoho_user_id text unique;

-- ── deals: child table ──────────────────────────────────────────────
-- Only deals whose Stage is one of the 5 "active prospect" stages are
-- ever synced (see ACTIVE_DEAL_STAGES in lib/zoho.ts) — this is the
-- actual filter that decides which accounts enter our scope at all,
-- discovered 2026-07-09 via the owner's live Custom View + empirical
-- COQL checks (Account_Type/Status turned out not to be queryable).
create table public.deals (
  id            uuid primary key default gen_random_uuid(),
  crm_record_id text not null unique,               -- Zoho Deal ID
  account_id    uuid not null references public.accounts (id) on delete cascade,
  name          text,                                -- Zoho "Deal_Name" ("Opportunity Name")
  stage         text,                                -- one of ACTIVE_DEAL_STAGES at last sync
  contact_name  text,                                -- Zoho "Contact_Name" lookup, flattened to its name
  mobile        text,                                -- Zoho "Mobile_No" (NOT "Mobile" — confirmed unused)
  cities        text[],                               -- Zoho "Cities" — multiselect; project city/cities,
                                                        --   distinct from the account's head-office city
  amount        numeric,                               -- Zoho "Expected_Value" (the only populated amount
                                                         --   field among 5 candidates — confirmed 2026-07-09)
  raw           jsonb,
  synced_at     timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index deals_account_idx on public.deals (account_id);
create index deals_stage_idx   on public.deals (stage);

create trigger on_deals_update
  before update on public.deals
  for each row execute function public.touch_updated_at();

alter table public.deals enable row level security;

-- Visibility piggybacks on the parent account, same pattern as
-- interactions/client_findings in 002.
create policy deals_select on public.deals
  for select using (
    exists (select 1 from public.accounts a where a.id = account_id)
  );
