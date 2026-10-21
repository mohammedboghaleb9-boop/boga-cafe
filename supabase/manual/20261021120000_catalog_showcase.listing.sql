-- SQL Editor block: lists the 16 compared rows for the catalog display (P5, owner 2026-10-21).
-- WHEN: after 20261021120000_catalog_showcase.editor.sql, with its own approval (it shows the rows on the site).
-- WHAT IT CHANGES: `listed` = true on exactly 10 products and 6 origins, the previous site's catalog as compared with
-- its source on 2026-10-21 (every text, recipe and display field equal to src/data/seed/catalog.ts). NOTHING ELSE: no
-- price, stock, sale switch (`active`), recipe or setting. The products' and origins' updated_at move to now (their
-- touch trigger): an Admin editor opened before it reloads once ("changed meanwhile").
-- STOPS (nothing changed) if the catalog is not exactly those 16 rows with that content (fingerprint), if a row is
-- already listed, or if one is for sale (active): a display, never an activation.
-- HOW: paste ALL of it (from "begin;" to the last select), select nothing, press Run. One transaction.
-- RESULT: the last select reads products 10, origins 6, shown_products 10, shown_origins 6, leaked_keys 0, active_rows 0.
-- UNDO: supabase/manual/20261021120000_catalog_showcase.unlist.sql.

begin;
set local lock_timeout = '3s';
-- no save may change a row between the checks and the update
lock table public.products, public.origins, public.product_recipes in share row exclusive mode;

do $$
declare
  v_products text[] := array['boga-signature', 'douceur-arabica', 'horeca-crema-forte', 'horeca-espresso-bar', 'horeca-premium-arabica',
                             'oriental-intense', 'so-brazil', 'so-colombia', 'so-ethiopia', 'so-honduras'];
  v_origins text[] := array['brazil', 'colombia', 'ethiopia', 'honduras', 'uganda', 'vietnam'];
  v_fingerprint text;
  v_n int;
begin
  if to_regprocedure('public.showcase_catalog()') is null
     or (select count(*) from information_schema.columns where table_schema = 'public' and table_name in ('products', 'origins') and column_name = 'listed') <> 2 then
    raise exception 'stop: 20261021120000_catalog_showcase is not applied: run its editor block first';
  end if;
  if (select array_agg(id order by id) from public.products) is distinct from v_products then
    raise exception 'stop: the products are not the 10 compared ones (%): tell Claude', (select array_agg(id order by id) from public.products);
  end if;
  if (select array_agg(id order by id) from public.origins) is distinct from v_origins then
    raise exception 'stop: the origins are not the 6 compared ones (%): tell Claude', (select array_agg(id order by id) from public.origins);
  end if;
  -- every display field of the 16 rows and their 22 recipe lines, as compared on 2026-10-21 (live = the source)
  select md5(string_agg(x, E'\n' order by x collate "C")) into v_fingerprint from (
    select 'product ' || p.id || ' ' || jsonb_build_object('slug', p.slug, 'kind', p.kind, 'name', p.name, 'tagline', p.tagline, 'description', p.description,
      'tasting_notes', p.tasting_notes, 'roast_level', p.roast_level, 'featured', p.featured, 'sort_order', p.sort_order, 'image_url', p.image_url,
      'recipe', (select jsonb_object_agg(r.origin_id, r.percent) from public.product_recipes r where r.product_id = p.id))::text
    from public.products p
    union all
    select 'origin ' || o.id || ' ' || jsonb_build_object('name', o.name, 'country_code', o.country_code, 'species', o.species, 'region', o.region,
      'roast_level', o.roast_level, 'tasting_notes', o.tasting_notes, 'custom_blend_enabled', o.custom_blend_enabled)::text
    from public.origins o
  ) t(x);
  if v_fingerprint is distinct from 'd8ad4e21d30eeba84bc109c635204f3e' then
    raise exception 'stop: a text, recipe or display field changed since the comparison (fingerprint %): tell Claude', v_fingerprint;
  end if;
  if (select count(*) from public.product_recipes) <> 22 then
    raise exception 'stop: the recipes are not the 22 compared lines: tell Claude';
  end if;
  if exists (select 1 from public.products where listed) or exists (select 1 from public.origins where listed) then
    raise exception 'stop: a row is already listed: tell Claude';
  end if;
  if exists (select 1 from public.products where active) or exists (select 1 from public.origins where active) then
    raise exception 'stop: a product or origin is for sale (active): this block only shows hidden rows, tell Claude';
  end if;

  update public.products set listed = true where id = any (v_products) and not listed;
  get diagnostics v_n = row_count;
  if v_n <> 10 then raise exception 'stop: % products listed, expected 10', v_n; end if;
  update public.origins set listed = true where id = any (v_origins) and not listed;
  get diagnostics v_n = row_count;
  if v_n <> 6 then raise exception 'stop: % origins listed, expected 6', v_n; end if;

  -- the public read now gives all 16, and nothing of a price, a stock or a date
  if jsonb_array_length(public.showcase_catalog() -> 'products') <> 10 or jsonb_array_length(public.showcase_catalog() -> 'origins') <> 6 then
    raise exception 'stop: showcase_catalog() does not return the 16 rows';
  end if;
  if public.showcase_catalog()::text ~ '"(prices|price_per_kg|stock_kg|low_stock_kg|restock_date|active|updated_at)"' then
    raise exception 'stop: showcase_catalog() returns a field it must not';
  end if;
end $$;

commit;

-- result, after the commit (nothing else is selected)
select
  (select count(*) from public.products where listed) as products,
  (select count(*) from public.origins where listed) as origins,
  jsonb_array_length(public.showcase_catalog() -> 'products') as shown_products,
  jsonb_array_length(public.showcase_catalog() -> 'origins') as shown_origins,
  (select count(*) from regexp_matches(public.showcase_catalog()::text, '"(prices|price_per_kg|stock_kg|low_stock_kg|restock_date|active|updated_at)"', 'g')) as leaked_keys,
  (select count(*) from public.products where active) + (select count(*) from public.origins where active) as active_rows;
