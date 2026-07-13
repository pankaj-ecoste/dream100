-- ════════════════════════════════════════════════════════════════════
-- Dream 100 — Migration 002: Row Level Security + triggers
-- RLS is THE security boundary of this app. The browser talks to
-- Postgres with the public anon key; these policies are the only thing
-- standing between a salesperson and other regions' data. That is why
-- Phase 0's exit metric is an RLS proof, not a UI demo.
-- ════════════════════════════════════════════════════════════════════

-- ── Helper functions ──────────────────────────────────────────────
-- "security definer" = runs as the function OWNER (bypasses RLS inside),
-- which prevents infinite recursion when a policy on `users` needs to
-- read `users` to learn the caller's role.
create or replace function public.current_user_role()
returns text
language sql stable security definer
set search_path = public
as $$
  select role from public.users where id = auth.uid();
$$;

create or replace function public.current_user_region()
returns text
language sql stable security definer
set search_path = public
as $$
  select region from public.users where id = auth.uid();
$$;

-- ── Enable RLS everywhere ─────────────────────────────────────────
-- Once enabled, a table with NO policy is invisible to normal users.
-- The service-role key (server-only) bypasses RLS — that's how the
-- webhook and cron write.
alter table public.users            enable row level security;
alter table public.accounts         enable row level security;
alter table public.interactions     enable row level security;
alter table public.client_findings  enable row level security;
alter table public.findings_history enable row level security;
alter table public.research_logs    enable row level security;
alter table public.sync_state       enable row level security;   -- no policies: service-role only

-- ── users ─────────────────────────────────────────────────────────
create policy users_select_self on public.users
  for select using (
    id = auth.uid() or public.current_user_role() = 'admin'
  );

-- ── accounts ──────────────────────────────────────────────────────
-- THE core rule: salesperson → own accounts; team leader → own region;
-- crm_handler and admin → everything. Writes happen server-side only
-- (service role), so no insert/update policies for normal users.
create policy accounts_select on public.accounts
  for select using (
    assigned_user_id = auth.uid()
    or public.current_user_role() in ('admin', 'crm_handler')
    or (public.current_user_role() = 'team_leader'
        and region = public.current_user_region())
  );

-- ── interactions / findings / history ─────────────────────────────
-- Visibility piggybacks on accounts: "if you can see the account, you
-- can see its data." The subquery re-applies the accounts policy.
create policy interactions_select on public.interactions
  for select using (
    exists (select 1 from public.accounts a where a.id = account_id)
  );

create policy client_findings_select on public.client_findings
  for select using (
    exists (select 1 from public.accounts a where a.id = account_id)
  );

create policy findings_history_select on public.findings_history
  for select using (
    exists (select 1 from public.accounts a where a.id = account_id)
  );

-- ── research_logs ─────────────────────────────────────────────────
-- You see your own runs; admin sees all (cost dashboard). Feedback
-- buttons update only your own rows.
create policy research_logs_select on public.research_logs
  for select using (
    user_id = auth.uid() or public.current_user_role() = 'admin'
  );

create policy research_logs_feedback on public.research_logs
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ══════════════════════════════════════════════════════════════════
-- TRIGGERS
-- ══════════════════════════════════════════════════════════════════

-- ── 1. Auto-create a users row on first Google sign-in ────────────
-- Supabase Auth inserts into auth.users; this mirrors it into
-- public.users with the safest default role. Admin promotes people
-- later (SQL editor or admin page).
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── 2. Findings archive: the "memory Zoho doesn't have" ───────────
-- Fires BEFORE every update on client_findings and snapshots the OLD
-- row into findings_history. App code cannot forget to archive,
-- because app code doesn't do the archiving. Powers Phase 4 comparison.
create or replace function public.archive_findings()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  insert into public.findings_history (
    account_id, linkedin_findings, rera_findings, website_findings,
    news_findings, final_analysis, saved_by, original_saved_at
  ) values (
    old.account_id, old.linkedin_findings, old.rera_findings,
    old.website_findings, old.news_findings, old.final_analysis,
    old.saved_by, old.updated_at
  );
  new.updated_at := now();
  return new;
end;
$$;

create trigger on_findings_update
  before update on public.client_findings
  for each row execute function public.archive_findings();

-- ── 3. Keep accounts.updated_at honest ────────────────────────────
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger on_accounts_update
  before update on public.accounts
  for each row execute function public.touch_updated_at();
