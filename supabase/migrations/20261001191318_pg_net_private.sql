-- ───────────── HTTP calls from the database: who may make them ─────────────
-- Intent: nothing a visitor or an admin does needs pg_net, so keep it to the server roles.
-- Result on the live project: NO EFFECT. Supabase grants EXECUTE on net.* to PUBLIC as
-- supabase_admin, and a REVOKE by postgres only removes grants postgres made itself
-- (checked 2026-10-01: grantor supabase_admin, grantee PUBLIC). The schema `net` is not
-- exposed through the API, so the functions cannot be called from the outside; this is
-- Supabase's default. Kept so this folder matches the migrations recorded on the server.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'net') then
    revoke all on all functions in schema net from public, anon, authenticated;
    revoke usage on schema net from public, anon, authenticated;
  end if;
end $$;
