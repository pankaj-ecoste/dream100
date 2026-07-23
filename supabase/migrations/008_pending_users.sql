-- ════════════════════════════════════════════════════════════════════
-- Dream 100 — Migration 008: admin-provisioned account activation
--
-- Replaces plan.md §10 Phase 0c's original design (plain self-signup,
-- no admin step). Owner's actual workflow (2026-07-23): admin adds a
-- staff member's name + email here (SQL Editor, no admin UI — same
-- convention as every other admin action in this project). The person
-- then opens the app, picks their name from this list, sets a
-- password, verifies a one-time email code, and their real
-- auth.users/public.users row is created — see app/api/account/*.
--
-- Deliberately outside the `auth` schema — never hand-write rows into
-- auth.users directly (unsupported, fragile: password hashing, many
-- generated columns). Real accounts are created via
-- supabase.auth.admin.createUser() in app/api/account/activate.
--
-- RLS enabled, NO policies — this table is only ever read/written by
-- server routes using the service-role client (same pattern as
-- sync_state, migration 002's comment: "no policies: service-role only").
-- A row is deleted once its person successfully activates.
-- ════════════════════════════════════════════════════════════════════

create table public.pending_users (
  id         uuid primary key default gen_random_uuid(),
  full_name  text not null,
  email      text not null unique,
  created_at timestamptz not null default now()
);

alter table public.pending_users enable row level security;
