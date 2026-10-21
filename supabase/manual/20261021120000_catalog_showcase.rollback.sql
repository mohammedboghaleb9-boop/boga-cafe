-- ROLLBACK of 20261021120000_catalog_showcase: no public read of the catalog display, no `listed` column, and the
-- visitors' read of products and origins back to init's rule (the rows for sale, whatever the sales state). Supabase SQL
-- Editor (it holds DROPs), ONE transaction. BEFORE: the site must not read the showcase any more (VITE_SHOWCASE off and
-- deployed), or its read fails and it shows the empty lists. Prices, stock, sale switches and texts are not touched.
-- RESULT: the last select reads function_present false, columns 0, init_rules 2. AFTER: remove the history row of 20261021120000 (a separate step).

begin;
set local lock_timeout = '3s';
alter policy "catalog read" on public.products using (active or public.is_admin());
alter policy "catalog read" on public.origins using (active or public.is_admin());
drop function public.sales_open();
drop function public.showcase_catalog();
alter table public.products drop column listed;
alter table public.origins drop column listed;
commit;

select
  to_regprocedure('public.showcase_catalog()') is not null as function_present,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name in ('products', 'origins') and column_name = 'listed') as columns,
  (select count(*) from pg_policies where schemaname = 'public' and tablename in ('products', 'origins') and policyname = 'catalog read'
     and qual = '(active OR is_admin())') as init_rules;
