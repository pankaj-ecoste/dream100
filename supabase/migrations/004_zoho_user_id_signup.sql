-- ════════════════════════════════════════════════════════════════════
-- Dream 100 — Migration 004: capture zoho_user_id at signup
-- Signup page now shows a dropdown of real Zoho users (lib/zoho.ts's
-- getZohoUsers(), via /api/zoho/users) instead of a free-text name
-- field. This just teaches the existing handle_new_user trigger (002)
-- to also read the zoho_user_id the client sends as auth metadata, so
-- a new signup is immediately matched to their already-synced accounts
-- (assigned_user_id) with no separate admin step.
-- ════════════════════════════════════════════════════════════════════

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, full_name, zoho_user_id)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
    new.raw_user_meta_data ->> 'zoho_user_id'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
