-- ════════════════════════════════════════════════════════════════════
-- Dream 100 — Migration 001: core tables
-- Run in Supabase SQL Editor (or `supabase db push` later).
-- 7 tables. accounts.crm_record_id is the spine of the whole system:
-- same Zoho record → same Supabase row, forever.
-- ════════════════════════════════════════════════════════════════════

-- ── users ─────────────────────────────────────────────────────────
-- One row per staff member. id MATCHES auth.users.id (Supabase Auth),
-- which is what makes RLS possible: auth.uid() = users.id.
create table public.users (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null unique,
  full_name   text,
  role        text not null default 'salesperson'
              check (role in ('salesperson', 'team_leader', 'crm_handler', 'admin')),
  region      text,                          -- e.g. 'Mumbai', 'Pune' — drives team-leader visibility
  created_at  timestamptz not null default now()
);

-- ── accounts ──────────────────────────────────────────────────────
-- One row per client, forever. Mirrors Zoho; never hard-deleted.
create table public.accounts (
  id               uuid primary key default gen_random_uuid(),
  crm_record_id    text not null unique,     -- Zoho permanent ID: the upsert key
  name             text not null,
  city             text,
  region           text,
  industry         text,
  lifecycle_stage  text,                     -- prospect / customer / ... (exact values from Day-4 Zoho call)
  assigned_user_id uuid references public.users (id),
  is_draft         boolean not null default false,  -- created in-app from not-found flow, pending CRM handler
  raw              jsonb,                    -- full Zoho payload as fetched — audit + future fields for free
  archived_at      timestamptz,              -- soft delete only (weekly reconciliation sets this)
  synced_at        timestamptz,              -- powers the "synced HH:MM" freshness stamp in the UI
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index accounts_name_idx     on public.accounts using gin (to_tsvector('simple', name));
create index accounts_city_idx     on public.accounts (city);
create index accounts_assigned_idx on public.accounts (assigned_user_id);

-- ── interactions ──────────────────────────────────────────────────
-- Meeting history: one row per Zoho note / call-visit report.
create table public.interactions (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references public.accounts (id) on delete cascade,
  crm_note_id   text unique,                 -- Zoho note ID → idempotent sync (re-import never duplicates)
  meeting_date  timestamptz,
  kind          text,                        -- note / call / visit
  content       text,
  created_at    timestamptz not null default now()
);

create index interactions_account_date_idx
  on public.interactions (account_id, meeting_date desc);

-- ── client_findings ───────────────────────────────────────────────
-- The CURRENT research picture: exactly one row per account, updated
-- in place. History is preserved automatically by trigger (see 002).
create table public.client_findings (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null unique references public.accounts (id) on delete cascade,
  linkedin_findings text,
  rera_findings     text,
  website_findings  text,
  news_findings     text,
  final_analysis    text,
  saved_by          uuid references public.users (id),
  updated_at        timestamptz not null default now()
);

-- ── findings_history ──────────────────────────────────────────────
-- Prior pictures, written ONLY by the archive trigger. Powers the
-- repeat-visit comparison and the audit trail. App code never writes here.
create table public.findings_history (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references public.accounts (id) on delete cascade,
  linkedin_findings text,
  rera_findings     text,
  website_findings  text,
  news_findings     text,
  final_analysis    text,
  saved_by          uuid,
  valid_until       timestamptz not null default now(),  -- when this picture was replaced
  original_saved_at timestamptz                          -- updated_at of the row it archived
);

create index findings_history_account_idx
  on public.findings_history (account_id, valid_until desc);

-- ── research_logs ─────────────────────────────────────────────────
-- Every agent run: cost accounting + 👍/👎 feedback + debugging trail.
create table public.research_logs (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid references public.users (id),
  account_id         uuid references public.accounts (id),
  run_type           text not null default 'research'   -- research / qa / comparison / cron_heartbeat
                     check (run_type in ('research', 'qa', 'comparison', 'cron_heartbeat')),
  model              text,
  input_tokens       integer not null default 0,
  output_tokens      integer not null default 0,
  cache_read_tokens  integer not null default 0,        -- weekly cache-hit review reads this
  estimated_cost_usd numeric(10, 5) not null default 0,
  duration_ms        integer,
  feedback           smallint check (feedback in (-1, 1)),  -- 👎 / 👍, null = no rating
  error              text,
  created_at         timestamptz not null default now()
);

create index research_logs_created_idx on public.research_logs (created_at desc);
create index research_logs_user_idx    on public.research_logs (user_id, created_at desc);

-- ── sync_state ────────────────────────────────────────────────────
-- Watermarks per sync module. last_success_at advances ONLY on success,
-- so a crashed run resumes from the last good point (resumable import).
create table public.sync_state (
  module          text primary key,          -- 'accounts_nightly' / 'bulk_import' / 'reconcile'
  last_run_at     timestamptz,
  last_success_at timestamptz,
  last_page       integer,                   -- bulk import resume cursor
  status          text,                      -- 'ok' / 'running' / 'error'
  error           text
);
