-- Catalog writes (P5 slice 9): products with their recipe, and origins, saved by the
-- Admin Panel through save_product() and save_origin() (save_product ported from the
-- map-test donor, f9ba067, where it was SECURITY INVOKER with no checks of its own).
--
-- Rules, all checked here, not only in the panel:
--   • owner and manager only, past the second factor (is_admin at aal2); staff moves
--     stock through adjust_stock() but never edits the catalog;
--   • an id (the product's address, the origin's key) is fixed once created: orders keep
--     the productId of what was bought;
--   • a new product or origin is created hidden (an origin also at 0 kg): it is shown
--     on purpose, after a check, never by accident;
--   • a save from an older copy of the page is refused ('stale'), as for B2B follow-ups;
--   • who did it is recorded, in catalog_changes (not a column of the catalog: visitors
--     read every column of a shown product or origin, and would read the admin's id).

create table public.catalog_changes (
  id      bigint generated always as identity primary key,
  at      timestamptz not null default now(),
  item    text not null check (item in ('product', 'origin')),
  item_id text not null,
  action  text not null check (action in ('create', 'edit')),
  actor   uuid
);
create index catalog_changes_item_idx on public.catalog_changes (item, item_id, at desc);
alter table public.catalog_changes enable row level security;
create policy "admins read" on public.catalog_changes for select using (public.is_admin());
revoke all on public.catalog_changes from anon, authenticated;
grant select on public.catalog_changes to authenticated;

-- Clock time, not the transaction's: each change gets its own mark, so a second save
-- from the same old copy is told apart (the stale checks below compare it).
-- (search_path kept as 20261001165327_harden set it: create or replace drops it otherwise)
create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end $$;

-- An origin's version (updated_at, compared by save_origin) moves with its details, not with
-- its stock: an order or a stock line between reading and saving never refuses the save.
-- CREATE OR REPLACE, not DROP: the tool that applies migrations to the live project hangs on DROP.
create or replace trigger origins_touch before update on public.origins
  for each row
  when ((old.id, old.name, old.country_code, old.species, old.region, old.roast_level, old.tasting_notes, old.low_stock_kg,
         old.price_per_kg, old.custom_blend_enabled, old.restock_date, old.active)
        is distinct from
        (new.id, new.name, new.country_code, new.species, new.region, new.roast_level, new.tasting_notes, new.low_stock_kg,
         new.price_per_kg, new.custom_blend_enabled, new.restock_date, new.active))
  execute function public.touch_updated_at();

-- An address-like id: "boga-signature", "ethiopie-2". 'new' is the panel's add-product address.
create or replace function public.catalog_id_ok(p_id text) returns boolean
language sql immutable set search_path = public, pg_temp as $$
  select p_id is not null and p_id ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(p_id) <= 90 and p_id <> 'new'
$$;

-- A text in three languages ({"ar", "fr", "en"}), each at most p_max characters.
create or replace function public.catalog_text_ok(p_text jsonb, p_max integer) returns boolean
language sql immutable set search_path = public, pg_temp as $$
  select jsonb_typeof(p_text) = 'object'
     and not exists (select 1 from jsonb_each(p_text) e
                      where e.key not in ('ar', 'fr', 'en') or jsonb_typeof(e.value) <> 'string'
                         or char_length(e.value #>> '{}') > p_max)
$$;

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

revoke all on function public.catalog_id_ok(text) from public, anon, authenticated;
revoke all on function public.catalog_text_ok(jsonb, integer) from public, anon, authenticated;
revoke all on function public.save_product(jsonb, jsonb, timestamptz) from public, anon;
revoke all on function public.save_origin(jsonb, timestamptz) from public, anon;
grant execute on function public.save_product(jsonb, jsonb, timestamptz) to authenticated;
grant execute on function public.save_origin(jsonb, timestamptz) to authenticated;

-- A hidden product's recipe is hidden too: a visitor reads the recipe of a shown product
-- only (it read every recipe until now). ALTER, not DROP: the tool that applies migrations
-- to the live project hangs on DROP.
alter policy "catalog read" on public.product_recipes
  using (public.is_admin() or exists (select 1 from public.products p where p.id = product_id and p.active));

-- The catalog changes only through the functions above and adjust_stock(), which run as
-- the tables' owner: the API roles keep reading it (row level security), nothing else
-- ("catalog write" stays, without effect).
revoke all on public.products, public.product_recipes, public.origins from anon, authenticated;
grant select on public.products, public.product_recipes, public.origins to anon, authenticated;
