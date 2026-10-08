-- ════════════════════════════════════════════════════════════════════
-- P5 slice 6: admin rights need the second factor (owner decision 2026-10-05).
-- ════════════════════════════════════════════════════════════════════

-- An admin_users member counts as an admin only once the session passed the second
-- factor (TOTP): Supabase Auth then puts aal = 'aal2' in the access token, and a token
-- without the claim is aal1. Every policy and function that grants admin rights goes
-- through is_admin() (admin_role() is only called here), so a session at aal1 reads
-- and writes like a visitor. Its own admin_users row stays readable ("see own admin
-- row"): the site asks for the second factor only for an admin account. Visitors and
-- the storefront function (secret key, no user) are unchanged: is_admin() was already
-- false for them.
create or replace function public.is_admin(allowed text[] default array['owner', 'manager', 'staff'])
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.admin_role() = any (allowed), false)
     and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
$$;
