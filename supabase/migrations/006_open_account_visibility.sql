-- ════════════════════════════════════════════════════════════════════
-- Dream 100 — Migration 006: open account visibility (V2 Phase 0)
--
-- Owner decision (2026-07-22): any authenticated user sees the full
-- company dataset, filtered only by Industry/Stage (and the two named
-- GHB presets) — not scoped to "accounts assigned to me."
--
-- Why: Zoho's Owner field (accounts.assigned_user_id's source) turned
-- out not to reliably reflect who the real field salesperson is — many
-- "Owner" identities are role-based/shared logins (sales@, sales02@,
-- support17@, etc.) with implausible account counts (200+) for one
-- person, confirmed live 2026-07-22 (see plan.md §0 Phase 1 "Blocked /
-- open"). Per-person RLS scoping built on that field was never a solid
-- security boundary to begin with — this migration removes it rather
-- than keep enforcing a rule the underlying data can't support. A
-- salesperson/owner-based filter may return later (plan.md §10 V2
-- Phase 0), but only if a real need shows up — not rebuilt here.
--
-- Every role was already a superset of "own accounts only" (admin/
-- crm_handler saw everything, team_leader saw their region), so this
-- is a strict widening: nothing that could see an account before loses
-- access. interactions/client_findings/findings_history need no change
-- — their policies (migration 002) already piggyback on "if you can
-- see the account, you can see its data."
-- ════════════════════════════════════════════════════════════════════

drop policy if exists accounts_select on public.accounts;

create policy accounts_select on public.accounts
  for select using (auth.uid() is not null);
