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
