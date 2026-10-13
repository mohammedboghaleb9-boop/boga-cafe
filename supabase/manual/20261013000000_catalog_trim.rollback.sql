-- ROLLBACK of 20261013000000_catalog_trim (P5 slice 11, second part). Supabase SQL Editor, ONE transaction, on a computer.
-- Run it ONLY if the trim of product and origin texts must be undone. It restores the two function bodies of
-- 20261009200000_catalog_writes.sql (they hold a DELETE, which the tool that applies migrations cannot run), drops the helper
-- config_trim_keys and removes the history row 20261013000000. Products, recipes and origins are not touched.
--
-- ORDER OF THE TWO ROLLBACKS: this one FIRST, then 20261012230000_config_trim.rollback.sql.
-- save_product / save_origin call config_trim_keys, which calls config_trim_text, which calls config_trim_str. These are SQL
-- functions: Postgres does not track the dependency, so dropping a helper too early does not fail, it breaks the saves at
-- their first call. This script stops by itself if the helper it drops is not there.
--
-- HOW: paste ALL of it (from "begin;" to the last select), select nothing, press Run. Any check that fails raises an
-- exception ("stop:") and nothing is changed. RESULT: bodies_restored 2, helper_gone true, history_row_left 0,
-- anon_runs false, signed_in_runs true, products/recipes/origins as they were.
-- Tests: tests/manual-sql.test.ts keeps the two bodies below equal to the ones in 20261009200000_catalog_writes.sql.

begin;

create temp table _catalog_before on commit drop as
  select (select count(*) from public.products) as products,
         (select count(*) from public.product_recipes) as recipes,
         (select count(*) from public.origins) as origins;

do $$
begin
  if to_regprocedure('public.config_trim_keys(jsonb, text[], text[])') is null then
    raise exception 'stop: config_trim_keys is not there, 20261013000000_catalog_trim is not applied (nothing to undo)';
  end if;
end $$;

-- >>> save_product and save_origin of 20261009200000_catalog_writes.sql
create or replace function public.save_product(p_product jsonb, p_recipe jsonb, p_seen_at timestamptz)
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id     text := p_product ->> 'id';
  v_new    boolean := p_seen_at is null;
  v_prices jsonb := coalesce(p_product -> 'prices', '{}'::jsonb);
  v_active boolean;
  v_sort   integer;
begin
  if not public.is_admin(array['owner', 'manager']) then
    raise exception 'forbidden';
  end if;
  if not public.catalog_id_ok(v_id) then
    raise exception 'invalid_id';
  end if;
  -- the address is the id: it never changes (orders keep the productId they were bought with)
  if p_product ? 'slug' and p_product ->> 'slug' is distinct from v_id then
    raise exception 'id_fixed';
  end if;
  if (p_product ->> 'kind') is null or (p_product ->> 'kind') not in ('signature', 'single-origin', 'b2b') then
    raise exception 'invalid_kind';
  end if;
  if (p_product ->> 'roastLevel') is null or (p_product ->> 'roastLevel') not in ('light', 'medium', 'medium-dark', 'dark') then
    raise exception 'invalid_roast';
  end if;
  if not public.catalog_text_ok(p_product -> 'name', 80) or coalesce(btrim(p_product #>> '{name,fr}'), '') = ''
     or not public.catalog_text_ok(coalesce(p_product -> 'tagline', '{}'), 200)
     or not public.catalog_text_ok(coalesce(p_product -> 'description', '{}'), 1000)
     or not public.catalog_text_ok(coalesce(p_product -> 'tastingNotes', '{}'), 200) then
    raise exception 'invalid_text';
  end if;
  -- a price is a real amount from 1 to 100 000 DH (src/core/pricing.ts isPrice, MAX_PRICE), only for the sold sizes
  -- (SQL does not promise the order of OR: a malformed value fails a cast, caught here)
  begin
    if jsonb_typeof(v_prices) <> 'object'
       or exists (select 1 from jsonb_each(v_prices) e
                  where e.key not in ('250', '500', '1000') or jsonb_typeof(e.value) <> 'number'
                     or (e.value #>> '{}')::numeric not between 1 and 100000) then
      raise exception 'invalid_price';
    end if;
  exception when others then
    raise exception 'invalid_price';
  end;
  begin
    v_sort := coalesce((p_product ->> 'sortOrder')::integer, 0);
    v_active := coalesce((p_product ->> 'active')::boolean, false);
  exception when others then
    raise exception 'invalid_product';
  end;
  -- a new product is created hidden; a shown product has at least one size for sale
  if v_new then
    v_active := false;
  end if;
  if v_active and not exists (select 1 from jsonb_each(v_prices)) then
    raise exception 'needs_price';
  end if;
  -- 1 to 8 different origins that exist, whole percentages adding up to 100
  begin
    if jsonb_typeof(p_recipe) <> 'array' or jsonb_array_length(p_recipe) not between 1 and 8
       or exists (select 1 from jsonb_array_elements(p_recipe) l
                  where jsonb_typeof(l -> 'percent') <> 'number'
                     or (l ->> 'percent')::numeric <> trunc((l ->> 'percent')::numeric)
                     or (l ->> 'percent')::numeric not between 1 and 100
                     or not exists (select 1 from public.origins o where o.id = l ->> 'originId'))
       or (select count(distinct l ->> 'originId') from jsonb_array_elements(p_recipe) l) <> jsonb_array_length(p_recipe)
       or (select sum((l ->> 'percent')::integer) from jsonb_array_elements(p_recipe) l) <> 100 then
      raise exception 'invalid_recipe';
    end if;
  exception when others then
    raise exception 'invalid_recipe';
  end;
  -- a shown product is made of shown origins only (a hidden one is new, or out of the range)
  if v_active and exists (select 1 from jsonb_array_elements(p_recipe) l join public.origins o on o.id = l ->> 'originId' where not o.active) then
    raise exception 'hidden_origin';
  end if;

  if v_new then
    if exists (select 1 from public.products where id = v_id or slug = v_id) then
      raise exception 'exists';
    end if;
    insert into public.products (id, slug, kind, name, tagline, description, roast_level, tasting_notes,
                                 prices, featured, active, sort_order)
    values (v_id, v_id, p_product ->> 'kind', p_product -> 'name', coalesce(p_product -> 'tagline', '{}'),
            coalesce(p_product -> 'description', '{}'), p_product ->> 'roastLevel', coalesce(p_product -> 'tastingNotes', '{}'),
            v_prices, coalesce((p_product ->> 'featured')::boolean, false), false, v_sort);
  else
    update public.products
       set kind = p_product ->> 'kind', name = p_product -> 'name', tagline = coalesce(p_product -> 'tagline', '{}'),
           description = coalesce(p_product -> 'description', '{}'), roast_level = p_product ->> 'roastLevel',
           tasting_notes = coalesce(p_product -> 'tastingNotes', '{}'), prices = v_prices,
           featured = coalesce((p_product ->> 'featured')::boolean, false), active = v_active, sort_order = v_sort
     where id = v_id and updated_at = p_seen_at;
    if not found then
      if exists (select 1 from public.products where id = v_id) then
        raise exception 'stale';
      end if;
      -- an id that does not exist: never a way to rename a product
      raise exception 'not_found';
    end if;
  end if;

  -- the recipe is replaced whole; product_recipes_total checks the sum again at commit
  delete from public.product_recipes where product_id = v_id;
  insert into public.product_recipes (product_id, origin_id, percent)
  select v_id, l ->> 'originId', (l ->> 'percent')::integer from jsonb_array_elements(p_recipe) l;
  insert into public.catalog_changes (item, item_id, action, actor) values ('product', v_id, case when v_new then 'create' else 'edit' end, auth.uid());
  return v_id;
end $$;

create or replace function public.save_origin(p_origin jsonb, p_seen_at timestamptz)
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id    text := p_origin ->> 'id';
  v_price numeric;
  v_low   numeric;
  v_blend boolean;
begin
  if not public.is_admin(array['owner', 'manager']) then
    raise exception 'forbidden';
  end if;
  if not public.catalog_id_ok(v_id) then
    raise exception 'invalid_id';
  end if;
  begin
    v_price := (p_origin ->> 'pricePerKg')::numeric;
    v_low := coalesce((p_origin ->> 'lowStockKg')::numeric, 5);
    v_blend := coalesce((p_origin ->> 'customBlendEnabled')::boolean, true);
  exception when others then
    raise exception 'invalid_origin';
  end;
  -- a blend is never free (src/core/pricing.ts isPrice, MAX_PRICE); 'NaN' and 'Infinity' are valid numeric values
  if v_price is null or v_price in ('NaN', 'Infinity') or v_price not between 1 and 100000 then
    raise exception 'invalid_price';
  end if;
  if v_low in ('NaN', 'Infinity') or v_low not between 0 and 100000 then
    raise exception 'invalid_low_stock';
  end if;

  if p_seen_at is null then
    if (p_origin ->> 'countryCode') is null or (p_origin ->> 'countryCode') !~ '^[A-Z]{2}$'
       or (p_origin ->> 'species') is null or (p_origin ->> 'species') not in ('arabica', 'robusta')
       or (p_origin ->> 'roastLevel') is null or (p_origin ->> 'roastLevel') not in ('light', 'medium', 'medium-dark', 'dark')
       or char_length(coalesce(p_origin ->> 'region', '')) > 80
       or not public.catalog_text_ok(p_origin -> 'name', 80) or coalesce(btrim(p_origin #>> '{name,fr}'), '') = ''
       or not public.catalog_text_ok(coalesce(p_origin -> 'tastingNotes', '{}'), 200) then
      raise exception 'invalid_origin';
    end if;
    if exists (select 1 from public.origins where id = v_id) then
      raise exception 'exists';
    end if;
    insert into public.origins (id, name, country_code, species, region, roast_level, tasting_notes,
                                stock_kg, low_stock_kg, price_per_kg, custom_blend_enabled, active)
    values (v_id, p_origin -> 'name', p_origin ->> 'countryCode', p_origin ->> 'species', coalesce(p_origin ->> 'region', ''),
            p_origin ->> 'roastLevel', coalesce(p_origin -> 'tastingNotes', '{}'), 0, v_low, v_price, v_blend, false);
  else
    update public.origins
       set price_per_kg = v_price, low_stock_kg = v_low, custom_blend_enabled = v_blend
     where id = v_id and updated_at = p_seen_at;
    if not found then
      if exists (select 1 from public.origins where id = v_id) then
        raise exception 'stale';
      end if;
      raise exception 'not_found';
    end if;
  end if;
  insert into public.catalog_changes (item, item_id, action, actor) values ('origin', v_id, case when p_seen_at is null then 'create' else 'edit' end, auth.uid());
  return v_id;
end $$;
-- <<< save_product and save_origin of 20261009200000_catalog_writes.sql

drop function public.config_trim_keys(jsonb, text[], text[]);
delete from supabase_migrations.schema_migrations where version = '20261013000000' and name = 'catalog_trim';

do $$
declare
  b record;
begin
  if (select md5(replace(prosrc, E'\r', '')) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'save_product') <> 'a4131de0cb2b2bed001d0787219ff878' then
    raise exception 'stop: save_product is not the slice 9 body';
  end if;
  if (select md5(replace(prosrc, E'\r', '')) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'save_origin') <> 'dfd0f6642ee688a093d612d6aee19c6d' then
    raise exception 'stop: save_origin is not the slice 9 body';
  end if;
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'config_trim_keys') <> 0 then
    raise exception 'stop: the helper is still there';
  end if;
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('save_product', 'save_origin')
        and prosecdef and proconfig @> array['search_path=public, pg_temp'] and has_function_privilege('authenticated', oid, 'execute')
        and not has_function_privilege('anon', oid, 'execute')
        and not exists (select 1 from aclexplode(coalesce(proacl, acldefault('f', proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')) <> 2 then
    raise exception 'stop: the rights of the two functions are not the ones of before';
  end if;
  select * into b from _catalog_before;
  if (select count(*) from public.products) <> b.products or (select count(*) from public.product_recipes) <> b.recipes
     or (select count(*) from public.origins) <> b.origins then
    raise exception 'stop: products, recipes or origins changed';
  end if;
  if (select count(*) from supabase_migrations.schema_migrations where version = '20261013000000') <> 0 then
    raise exception 'stop: the history row is still there';
  end if;
end $$;

commit;

select (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('save_product', 'save_origin')
          and md5(replace(prosrc, E'\r', '')) in ('a4131de0cb2b2bed001d0787219ff878', 'dfd0f6642ee688a093d612d6aee19c6d')) as bodies_restored,
       to_regprocedure('public.config_trim_keys(jsonb, text[], text[])') is null as helper_gone,
       (select count(*) from supabase_migrations.schema_migrations where version = '20261013000000') as history_row_left,
       has_function_privilege('anon', 'public.save_product(jsonb, jsonb, timestamptz)', 'execute') as anon_runs,
       has_function_privilege('authenticated', 'public.save_product(jsonb, jsonb, timestamptz)', 'execute') as signed_in_runs,
       (select count(*) from public.products) as products,
       (select count(*) from public.product_recipes) as recipes,
       (select count(*) from public.origins) as origins;
