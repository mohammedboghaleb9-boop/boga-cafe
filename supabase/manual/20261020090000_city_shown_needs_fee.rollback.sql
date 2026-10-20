-- ROLLBACK of 20261020090000_city_shown_needs_fee: the database accepts a shown city with a base fee of 0 again
-- (the Admin Panel still refuses it). Supabase SQL Editor (it holds a DROP), ONE transaction.
-- RESULT: the last select reads check_present = false. AFTER: remove the history row of 20261020090000 (a separate step).

begin;
set local lock_timeout = '3s';
alter table public.shipping_rates drop constraint shipping_rates_shown_needs_fee;
commit;

select exists (select 1 from pg_constraint where conname = 'shipping_rates_shown_needs_fee') as check_present;
