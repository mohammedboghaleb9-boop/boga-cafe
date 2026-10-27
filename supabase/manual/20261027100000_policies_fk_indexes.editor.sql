-- SQL Editor block for 20261027100000_policies_fk_indexes (P5.4).
-- WHY HERE: the migration holds DROP POLICY, which the tool that applies migrations hangs on; the block also records the
-- file's own version (20261027100000) in the migration history.
-- WHAT IT CHANGES: 3 indexes on foreign keys and the write policies of origins, products, product_recipes,
-- shipping_rates and admin_users, one per command instead of FOR ALL; NO ROW, nobody's right changes.
-- HOW: paste ALL of it (from "begin;" to the last select), select nothing, press Run. One transaction: any check that
-- fails raises "stop: ..." and nothing is changed. The text between the two markers is the migration file unchanged
-- (tests/manual-sql.test.ts keeps them equal).
-- RESULT: the last select reads indexes 3, for_all_policies 0, select_policies_over_one 0, history_rows 1.
-- ROLLBACK (after a commit): supabase/manual/20261027100000_policies_fk_indexes.rollback.sql, then remove the history row.

begin;
set local lock_timeout = '3s';

do $$
begin
  if exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'orders_city_id_idx') then
    raise exception 'stop: the indexes are already there (nothing to do)';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261027100000') then
    raise exception 'stop: 20261027100000 is already in the history: tell Claude';
  end if;
  if (select max(version) from supabase_migrations.schema_migrations) not in ('20261021120000', '20261027090000') then
    raise exception 'stop: the history does not end at 20261021120000_catalog_showcase or 20261027090000_quote_lines_for_sale: tell Claude';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and policyname = 'catalog write' and cmd = 'ALL') <> 4
     or (select count(*) from pg_policies where schemaname = 'public' and policyname = 'owner manages admins' and cmd = 'ALL') <> 1 then
    raise exception 'stop: the FOR ALL policies are not the 5 expected (4 catalog write, owner manages admins): tell Claude';
  end if;
end $$;

-- >>> 20261027100000_policies_fk_indexes.sql
-- Foreign-key indexes and one permissive policy per table, role and action (P5.4, advisors of docs/12 §3.2).
--
-- 1. Indexes on the three foreign keys the performance advisor lists without one: orders.city_id,
--    orders.payment_method, quote_requests.city_id. The tables are empty on live (0 orders, 0 B2B requests).
-- 2. "catalog write" (origins, products, product_recipes, shipping_rates) and "owner manages admins" (admin_users) were
--    FOR ALL, so each also answered every SELECT next to the read policy: 25 'multiple_permissive_policies' findings.
--    Each is replaced by one policy per write command (INSERT, UPDATE, DELETE) with the same condition. The read side
--    is not touched in effect: "catalog read" already lets every admin read (is_admin() is the wider test), and
--    "see own admin row" now also lets the owner read every admin row, which "owner manages admins" did before.
--    Who may write is unchanged (owner and manager for the catalog, owner for admin_users); the API roles keep the
--    grants they had (the catalog changes through functions, supabase/tests/aal.sql and writes.sql check the matrix).
--
-- No row changes. It holds DROP POLICY, which the tool that applies migrations hangs on, so it goes through the SQL
-- Editor block supabase/manual/20261027100000_policies_fk_indexes.editor.sql.
-- Rollback: supabase/manual/20261027100000_policies_fk_indexes.rollback.sql (SQL Editor).

create index orders_city_id_idx on public.orders (city_id);
create index orders_payment_method_idx on public.orders (payment_method);
create index quote_requests_city_id_idx on public.quote_requests (city_id);

drop policy "catalog write" on public.origins;
create policy "catalog insert" on public.origins for insert with check (public.is_admin(array['owner', 'manager']));
create policy "catalog update" on public.origins for update using (public.is_admin(array['owner', 'manager'])) with check (public.is_admin(array['owner', 'manager']));
create policy "catalog delete" on public.origins for delete using (public.is_admin(array['owner', 'manager']));

drop policy "catalog write" on public.products;
create policy "catalog insert" on public.products for insert with check (public.is_admin(array['owner', 'manager']));
create policy "catalog update" on public.products for update using (public.is_admin(array['owner', 'manager'])) with check (public.is_admin(array['owner', 'manager']));
create policy "catalog delete" on public.products for delete using (public.is_admin(array['owner', 'manager']));

drop policy "catalog write" on public.product_recipes;
create policy "catalog insert" on public.product_recipes for insert with check (public.is_admin(array['owner', 'manager']));
create policy "catalog update" on public.product_recipes for update using (public.is_admin(array['owner', 'manager'])) with check (public.is_admin(array['owner', 'manager']));
create policy "catalog delete" on public.product_recipes for delete using (public.is_admin(array['owner', 'manager']));

drop policy "catalog write" on public.shipping_rates;
create policy "catalog insert" on public.shipping_rates for insert with check (public.is_admin(array['owner', 'manager']));
create policy "catalog update" on public.shipping_rates for update using (public.is_admin(array['owner', 'manager'])) with check (public.is_admin(array['owner', 'manager']));
create policy "catalog delete" on public.shipping_rates for delete using (public.is_admin(array['owner', 'manager']));

drop policy "owner manages admins" on public.admin_users;
create policy "owner inserts admins" on public.admin_users for insert with check (public.is_admin(array['owner']));
create policy "owner updates admins" on public.admin_users for update using (public.is_admin(array['owner'])) with check (public.is_admin(array['owner']));
create policy "owner deletes admins" on public.admin_users for delete using (public.is_admin(array['owner']));
alter policy "see own admin row" on public.admin_users using (user_id = (select auth.uid()) or public.is_admin(array['owner']));
-- <<< 20261027100000_policies_fk_indexes.sql

insert into supabase_migrations.schema_migrations (version, name) values ('20261027100000', 'policies_fk_indexes');

commit;

-- result, after the commit (nothing else is selected)
select
  (select count(*) from pg_indexes where schemaname = 'public' and indexname in ('orders_city_id_idx', 'orders_payment_method_idx', 'quote_requests_city_id_idx')) as indexes,
  (select count(*) from pg_policies where schemaname = 'public' and cmd = 'ALL' and policyname in ('catalog write', 'owner manages admins')) as for_all_policies,
  (select count(*) from (select 1 from pg_policies where schemaname = 'public' and permissive = 'PERMISSIVE' and cmd in ('SELECT', 'ALL')
                          group by tablename having count(*) > 1) x) as select_policies_over_one,
  (select count(*) from supabase_migrations.schema_migrations where version = '20261027100000') as history_rows;
