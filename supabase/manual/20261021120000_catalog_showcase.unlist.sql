-- UNDO of 20261021120000_catalog_showcase.listing.sql: the catalog is hidden again (the site shows its empty lists,
-- as before the listing). Changes `listed` only: no price, stock, sale switch or text. Supabase SQL Editor, ONE transaction.
-- RESULT: the last select reads listed_rows 0, shown 0.

begin;
set local lock_timeout = '3s';
update public.products set listed = false where listed;
update public.origins set listed = false where listed;
commit;

select
  (select count(*) from public.products where listed) + (select count(*) from public.origins where listed) as listed_rows,
  jsonb_array_length(public.showcase_catalog() -> 'products') + jsonb_array_length(public.showcase_catalog() -> 'origins') as shown;
