-- Supabase gives its API roles every privilege on each new table, sequence and function as
-- it is created, and lets RLS decide. Set as default privileges BEFORE the migrations run, as
-- Supabase does, so a migration that revokes a privilege keeps it revoked here too.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
