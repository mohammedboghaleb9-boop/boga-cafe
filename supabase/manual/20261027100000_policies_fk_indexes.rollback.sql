-- ROLLBACK of 20261027100000_policies_fk_indexes: the FOR ALL policies and the one-purpose read policy come back, the
-- three indexes go. Supabase SQL Editor (it holds DROPs), ONE transaction. Only with the owner's approval.
-- RESULT: the last select reads for_all_policies 5, indexes 0. AFTER: remove the history row of 20261027100000 (a separate step).

begin;
set local lock_timeout = '3s';
drop index public.orders_city_id_idx;
drop index public.orders_payment_method_idx;
drop index public.quote_requests_city_id_idx;

drop policy "catalog insert" on public.origins;
drop policy "catalog update" on public.origins;
drop policy "catalog delete" on public.origins;
create policy "catalog write" on public.origins for all
  using (public.is_admin(array['owner', 'manager'])) with check (public.is_admin(array['owner', 'manager']));

drop policy "catalog insert" on public.products;
drop policy "catalog update" on public.products;
drop policy "catalog delete" on public.products;
create policy "catalog write" on public.products for all
  using (public.is_admin(array['owner', 'manager'])) with check (public.is_admin(array['owner', 'manager']));

drop policy "catalog insert" on public.product_recipes;
drop policy "catalog update" on public.product_recipes;
drop policy "catalog delete" on public.product_recipes;
create policy "catalog write" on public.product_recipes for all
  using (public.is_admin(array['owner', 'manager'])) with check (public.is_admin(array['owner', 'manager']));

drop policy "catalog insert" on public.shipping_rates;
drop policy "catalog update" on public.shipping_rates;
drop policy "catalog delete" on public.shipping_rates;
create policy "catalog write" on public.shipping_rates for all
  using (public.is_admin(array['owner', 'manager'])) with check (public.is_admin(array['owner', 'manager']));

drop policy "owner inserts admins" on public.admin_users;
drop policy "owner updates admins" on public.admin_users;
drop policy "owner deletes admins" on public.admin_users;
create policy "owner manages admins" on public.admin_users for all
  using (public.is_admin(array['owner'])) with check (public.is_admin(array['owner']));
alter policy "see own admin row" on public.admin_users using (user_id = (select auth.uid()));
commit;

select
  (select count(*) from pg_policies where schemaname = 'public' and cmd = 'ALL' and policyname in ('catalog write', 'owner manages admins')) as for_all_policies,
  (select count(*) from pg_indexes where schemaname = 'public' and indexname in ('orders_city_id_idx', 'orders_payment_method_idx', 'quote_requests_city_id_idx')) as indexes;
