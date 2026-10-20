-- SQL Editor block for 20261020090000_city_shown_needs_fee (P5 slice 13).
-- WHY HERE: the history then keeps the file's own version, 20261020090000 (the tool that applies migrations stamps
-- its own timestamp, and the file would have to be renamed again, as 20261016180000 -> 20261019200936 was).
-- WHAT IT CHANGES: one check on shipping_rates, a shown city has a base fee above 0; NO ROW. Then the version is
-- recorded once in the migration history.
-- HOW: paste ALL of it (from "begin;" to the last select), select nothing, press Run. One transaction: any check that
-- fails raises "stop: ..." and nothing is changed. The text between the two markers is the migration file unchanged
-- (tests/manual-sql.test.ts keeps them equal).
-- RESULT: the last select reads check_present true, shown_at_zero 0, history_rows 1.
-- ROLLBACK (after a commit): supabase/manual/20261020090000_city_shown_needs_fee.rollback.sql, then remove the history row.

begin;
set local lock_timeout = '3s';

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'shipping_rates_shown_needs_fee') then
    raise exception 'stop: the check is already there (nothing to do)';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261020090000') then
    raise exception 'stop: 20261020090000 is already in the history: tell Claude';
  end if;
  if (select max(version) from supabase_migrations.schema_migrations) is distinct from '20261019200936' then
    raise exception 'stop: the history does not end at 20261019200936_expiry_lock_order: tell Claude';
  end if;
  if exists (select 1 from public.shipping_rates where active and base_fee <= 0) then
    raise exception 'stop: a shown city has a base fee of 0: nothing is hidden or re-priced here, tell Claude';
  end if;
end $$;

-- >>> 20261020090000_city_shown_needs_fee.sql
-- A shown delivery city has a base fee above 0 (P5 slice 13, owner 2026-10-19).
--
-- The real start set every city's fees to 0 and hid them: 0 means "not priced yet", never free delivery (free
-- delivery is settings.freeShippingOver). The Admin Panel already refuses to show a city with a base fee of 0
-- (src/core/config.ts shippingRateOk); this makes the database refuse it too, whoever writes: save_shipping_rate,
-- a direct table write, the service key. A hidden city may keep 0 until its real tariff is entered; showing it
-- and giving it its fee happen in the same save. With a base above 0 the cap (max_fee >= base_fee) cannot bring
-- a fee back to 0 either. The included weight is not touched (owner 2026-10-19: it stays the city's own value).
--
-- No row changes: it stops ("violated by some row") if a shown city has a base fee of 0, so nothing is hidden or
-- re-priced behind the owner's back. Live on 2026-10-19: all 20 cities hidden, so it applies as is.
-- Rollback: supabase/manual/20261020090000_city_shown_needs_fee.rollback.sql (drops the check; SQL Editor).

alter table public.shipping_rates
  add constraint shipping_rates_shown_needs_fee check (not active or base_fee > 0);
-- <<< 20261020090000_city_shown_needs_fee.sql

insert into supabase_migrations.schema_migrations (version, name) values ('20261020090000', 'city_shown_needs_fee');

commit;

-- result, after the commit (nothing else is selected)
select
  exists (select 1 from pg_constraint where conname = 'shipping_rates_shown_needs_fee' and convalidated) as check_present,
  (select count(*) from public.shipping_rates where active and base_fee <= 0) as shown_at_zero,
  (select count(*) from supabase_migrations.schema_migrations where version = '20261020090000') as history_rows;
