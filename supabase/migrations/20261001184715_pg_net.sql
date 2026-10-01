-- ───────────── HTTP calls from the database ─────────────
-- pg_net: checks of the storefront function over HTTP from the database (the
-- tools here cannot reach the project directly), and scheduled sending of the
-- notification outbox later (phase 4). Skipped on a plain PostgreSQL without it.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
  end if;
end $$;
