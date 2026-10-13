-- Product and origin texts are saved without the spaces and line breaks at their start and end
-- (P5 slice 11, second part; the first, 20261013090048_config_trim, did the settings, the texts,
-- the recipients, the payment methods and the delivery prices).
--
-- save_product keeps what the panel sends: a product name edited and put back would end with a
-- space, as the hero title did. Now name, tagline, description and tasting notes (save_product),
-- and name, tasting notes and region (save_origin) are trimmed (space, tab, CR, LF; nothing
-- inside a text changes) BEFORE they are checked, so a length limit counts what is kept and a
-- French name of spaces only is no name. The id, the kind, the roast level and the other fixed
-- values are NOT trimmed: ' signature' is refused, as before.
--
-- A key that is not sent stays not sent. The functions give optional texts a default
-- (coalesce(p_product -> 'tagline', '{}')) and that default only applies to an SQL NULL: a key
-- written back with jsonb_build_object('tagline', <null>) would be a JSON null, which is not
-- NULL, would skip the default and be refused. config_trim_keys therefore trims the keys that
-- are present and leaves the others out (supabase/tests/catalog_trim.sql pins this).
--
-- This migration holds a DELETE (save_product replaces the recipe whole, as the slice 9 original
-- does): the tool that applies migrations to the live project hangs on it, so the owner runs it
-- in the SQL Editor, in one transaction, then the version is recorded by hand (PROJECT_NOTES.md).
-- It needs config_trim_str and config_trim_text from 20261013090048_config_trim.sql, applied first:
-- without them the functions would fail at their first call, so this stops before changing anything.
-- create or replace keeps each function's owner and grants. Rollback: the two bodies of
-- 20261009200000_catalog_writes.sql, then the helper below dropped.

do $$
begin
  if to_regprocedure('public.config_trim_text(jsonb)') is null or to_regprocedure('public.config_trim_str(jsonb)') is null then
    raise exception 'stop: config_trim_text / config_trim_str are missing, apply 20261013090048_config_trim first';
  end if;
end $$;

-- p_obj with each listed key that is present trimmed (p_texts: a text in three languages, p_strings:
-- a plain string); a key that is not there is not added; anything but an object comes back as it is.
create or replace function public.config_trim_keys(p_obj jsonb, p_texts text[], p_strings text[] default '{}')
returns jsonb
language sql immutable set search_path = public, pg_temp as $$
  select case when jsonb_typeof(p_obj) = 'object'
    then p_obj
         || coalesce((select jsonb_object_agg(k, public.config_trim_text(p_obj -> k)) from unnest(p_texts) k where p_obj ? k), '{}'::jsonb)
         || coalesce((select jsonb_object_agg(k, public.config_trim_str(p_obj -> k)) from unnest(p_strings) k where p_obj ? k), '{}'::jsonb)
    else p_obj end
$$;

revoke all on function public.config_trim_keys(jsonb, text[], text[]) from public, anon, authenticated;

-- p_product: the product as the panel builds it (src/core/types.ts Product, camelCase);
-- p_recipe: [{"originId", "percent"}]; p_seen_at: the product's updated_at as the page read
-- it, or null for a new product. Returns the product's id.
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
  -- the four texts, trimmed before they are checked; a text that is not sent stays not sent, so its default below still applies
  p_product := public.config_trim_keys(p_product, array['name', 'tagline', 'description', 'tastingNotes']);
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

-- p_origin: the origin as the panel builds it (src/core/types.ts Origin); p_seen_at: its
-- updated_at as the page read it, or null for a new origin. A new origin is created hidden,
-- at 0 kg (its first lot comes through adjust_stock); afterwards only its price per kg,
-- its alert level and the Custom Blend switch change here. Returns the origin's id.
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
  -- name, tasting notes and region, trimmed before they are checked; one that is not sent stays not sent (its default below still applies)
  p_origin := public.config_trim_keys(p_origin, array['name', 'tastingNotes'], array['region']);
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
