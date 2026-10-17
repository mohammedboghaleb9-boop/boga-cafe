-- The catalog ready for the real data, and sales closed until the owner opens them (P5 slice 12).
--
-- Owner's decisions, 2026-10-16 (the "real start"): the six approved origins keep their definitions,
-- their stock goes to 0 and their example prices go away; the ten products stay hidden drafts without
-- prices; delivery to Oujda, Berkane and Nador is 20 DH up to 4 kg (4 included) and 30 DH above, at
-- any weight; nothing is sold before the owner opens the sales, enforced here, at the final write.
-- This migration only makes that possible; it changes no row (the cleanup is a separate, approved step).
--
--   1. origins.price_per_kg may be empty: an origin without an approved price is not offered.
--      An origin is shown (active) only with a price (constraint, and save_origin says 'needs_price').
--   2. save_origin edits the whole definition of an origin (name, country, species, region, roast,
--      tasting notes), its price (or none), alert level, Custom Blend switch and whether it is shown.
--      Never its stock (only adjust_stock and the orders, each with a history line) nor its id.
--   3. shipping_rates.max_fee: an optional cap on a city's fee. Fee = base_fee + extra_per_kg per started
--      kg above included_kg, at most max_fee. The owner's tariff: base 20, included 4, extra 10, cap 30.
--   4. Sales gate: settings.salesOpen. Orders and B2B requests are saved only while it is exactly true;
--      missing, false or anything else = closed. commit_order and commit_quote_request check it under a
--      lock on the settings row (a sale in progress finishes first, the next one sees the change), before
--      a number is taken; check_order checks it too. Only the owner changes it (set_sales_open, at aal2,
--      recorded in config_changes as a 'rules' change, item salesOpen:open or salesOpen:closed; closing is
--      never refused as 'stale'). Orders already saved keep their whole life cycle (status, payment,
--      expiry): the gate only stops new ones. It stops the API roles and application mistakes; a holder
--      of the secret (service_role) key can still write tables directly, as for every other rule here.
--   5. Hiding an origin and showing a product made of it, by two admins at the same instant: save_origin
--      locks the origin (for update) and save_product its recipe's origins (for key share, in id order, on every
--      save) before their checks, so one waits for the other and refuses ('origin_in_use' or 'hidden_origin').
--
-- create or replace keeps each function's owner and grants. "drop not null" is a DROP for the tool that
-- applies migrations to the live project (it hangs on DROP and DELETE): the owner runs this file in the
-- SQL Editor from supabase/manual/20261016120000_catalog_ready.editor.sql, after the merge into main.
-- Rollback (catalog part only, the gate stays): supabase/manual/20261016120000_catalog_ready.rollback.sql.

-- the delivery table first, then the origins: the order the orders themselves take them in
-- ───────────── 3. A cap on a city's delivery fee ─────────────
alter table public.shipping_rates add column max_fee numeric(10, 2)
  check (max_fee is null or (max_fee <> 'NaN' and max_fee >= base_fee and max_fee <= 1000));

-- ───────────── 1. An origin's price may be empty; shown only with one ─────────────
alter table public.origins alter column price_per_kg drop not null;
alter table public.origins add constraint origins_active_needs_price check (not active or price_per_kg is not null);

-- ───────────── 4. The sales gate ─────────────
-- p_open: the owner's choice; p_seen: versions.sales as the page read it ('stale' from an older copy).
create or replace function public.set_sales_open(p_open boolean, p_seen text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin(array['owner']) then
    raise exception 'forbidden';
  end if;
  if p_open is null then
    raise exception 'invalid_settings';
  end if;
  -- opening from an older copy of the page is refused ('stale'); closing is always safe, never refused
  if p_open then
    perform public.config_section_seen('sales', p_seen);
  end if;
  update public.site_config
     set settings = settings || jsonb_build_object('salesOpen', p_open),
         versions = versions || jsonb_build_object('sales', clock_timestamp()::text)
   where id = 1;
  if not found then
    raise exception 'not_found';
  end if;
  perform public.config_saved('rules', case when p_open then 'salesOpen:open' else 'salesOpen:closed' end);
end $$;

revoke all on function public.set_sales_open(boolean, text) from public, anon;
grant execute on function public.set_sales_open(boolean, text) to authenticated;

-- ───────────── 2. save_origin: the whole definition, a price or none, shown or hidden ─────────────
-- p_origin: src/core/types.ts Origin; p_seen_at null = a new origin (created hidden, at 0 kg), else
-- its updated_at as the page read it ('stale' from an older copy). Owner and manager, at aal2.
create or replace function public.save_origin(p_origin jsonb, p_seen_at timestamptz)
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id     text := p_origin ->> 'id';
  v_price  numeric;
  v_low    numeric;
  v_blend  boolean;
  v_active boolean;
begin
  if not public.is_admin(array['owner', 'manager']) then
    raise exception 'forbidden';
  end if;
  if not public.catalog_id_ok(v_id) then
    raise exception 'invalid_id';
  end if;
  -- an edit: what is not sent, or sent as null, stays as it is; only the price sent as null means none.
  -- A page from before this version sends neither the definition's every field nor whether the origin is shown.
  if p_seen_at is not null then
    if not exists (select 1 from public.origins where id = v_id) then
      raise exception 'not_found';
    end if;
    p_origin := (select jsonb_build_object('name', o.name, 'countryCode', o.country_code, 'species', o.species, 'region', o.region,
                                           'roastLevel', o.roast_level, 'tastingNotes', o.tasting_notes, 'pricePerKg', o.price_per_kg,
                                           'lowStockKg', o.low_stock_kg, 'customBlendEnabled', o.custom_blend_enabled, 'active', o.active)
                   from public.origins o where o.id = v_id)
                || (select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) from jsonb_each(p_origin) e
                     where jsonb_typeof(e.value) <> 'null' or e.key = 'pricePerKg');
  end if;
  -- the two switches are JSON booleans (a text or a number never shows an origin)
  if jsonb_typeof(p_origin -> 'active') not in ('boolean', 'null') or jsonb_typeof(p_origin -> 'customBlendEnabled') not in ('boolean', 'null') then
    raise exception 'invalid_origin';
  end if;
  -- name, tasting notes and region, trimmed before they are checked; one that is not sent stays not sent (its default below still applies)
  p_origin := public.config_trim_keys(p_origin, array['name', 'tastingNotes'], array['region']);
  -- the price: a number, or none (missing or null) for an origin not offered yet
  if jsonb_typeof(p_origin -> 'pricePerKg') is not null and jsonb_typeof(p_origin -> 'pricePerKg') not in ('number', 'null') then
    raise exception 'invalid_price';
  end if;
  begin
    v_price := (p_origin ->> 'pricePerKg')::numeric;
    v_low := coalesce((p_origin ->> 'lowStockKg')::numeric, 5);
    v_blend := coalesce((p_origin ->> 'customBlendEnabled')::boolean, true);
    v_active := coalesce((p_origin ->> 'active')::boolean, false);
  exception when others then
    raise exception 'invalid_origin';
  end;
  -- a blend is never free (src/core/pricing.ts isPrice, MAX_PRICE); JSON has no 'NaN' or 'Infinity'
  if v_price is not null and v_price not between 1 and 100000 then
    raise exception 'invalid_price';
  end if;
  if v_low not between 0 and 100000 then
    raise exception 'invalid_low_stock';
  end if;
  -- the whole definition, checked on a new origin and on an edit alike
  if (p_origin ->> 'countryCode') is null or (p_origin ->> 'countryCode') !~ '^[A-Z]{2}$'
     or (p_origin ->> 'species') is null or (p_origin ->> 'species') not in ('arabica', 'robusta')
     or (p_origin ->> 'roastLevel') is null or (p_origin ->> 'roastLevel') not in ('light', 'medium', 'medium-dark', 'dark')
     or char_length(coalesce(p_origin ->> 'region', '')) > 80
     or not public.catalog_text_ok(p_origin -> 'name', 80) or coalesce(btrim(p_origin #>> '{name,fr}'), '') = ''
     or not public.catalog_text_ok(coalesce(p_origin -> 'tastingNotes', '{}'), 200) then
    raise exception 'invalid_origin';
  end if;

  if p_seen_at is null then
    if exists (select 1 from public.origins where id = v_id) then
      raise exception 'exists';
    end if;
    -- created hidden, at 0 kg: its first lot comes through adjust_stock, with a history line
    insert into public.origins (id, name, country_code, species, region, roast_level, tasting_notes,
                                stock_kg, low_stock_kg, price_per_kg, custom_blend_enabled, active)
    values (v_id, p_origin -> 'name', p_origin ->> 'countryCode', p_origin ->> 'species', coalesce(p_origin ->> 'region', ''),
            p_origin ->> 'roastLevel', coalesce(p_origin -> 'tastingNotes', '{}'), 0, v_low, v_price, v_blend, false);
  else
    -- the row first: a product being shown with this origin at the same instant (save_product holds it for key share)
    -- is waited for, and every check below then reads what that save committed (each statement reads anew)
    perform 1 from public.origins o where o.id = v_id for update;
    -- shown only with a price (also the table's constraint origins_active_needs_price)
    if v_active and v_price is null then
      raise exception 'needs_price';
    end if;
    -- never hidden under a shown product (save_product's rule 'hidden_origin', from the origin's side):
    -- hide the products first
    if not v_active and (select o.active from public.origins o where o.id = v_id)
       and exists (select 1 from public.product_recipes r join public.products p on p.id = r.product_id where r.origin_id = v_id and p.active) then
      raise exception 'origin_in_use';
    end if;
    update public.origins
       set name = p_origin -> 'name', country_code = p_origin ->> 'countryCode', species = p_origin ->> 'species',
           region = coalesce(p_origin ->> 'region', ''), roast_level = p_origin ->> 'roastLevel',
           tasting_notes = coalesce(p_origin -> 'tastingNotes', '{}'),
           price_per_kg = v_price, low_stock_kg = v_low, custom_blend_enabled = v_blend, active = v_active
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

-- ───────────── 3. save_shipping_rate: the cap ─────────────
-- A city's delivery price (src/core/types.ts ShippingRate): owner and manager. p_seen null =
-- a new city, created hidden (shown on purpose, after a check). Its id never changes.
-- maxFee: a whole number of DH, at least the base fee; null = no cap; not sent on an edit = the cap stays
-- (a page from before this version never removes it).
create or replace function public.save_shipping_rate(p_rate jsonb, p_seen timestamptz) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id  text := p_rate ->> 'id';
  v_max numeric;
begin
  if not public.is_admin(array['owner', 'manager']) then
    raise exception 'forbidden';
  end if;
  if not public.catalog_id_ok(v_id) then
    raise exception 'invalid_id';
  end if;
  p_rate := p_rate || jsonb_build_object('city', public.config_trim_text(p_rate -> 'city'), 'deliveryDays', public.config_trim_str(p_rate -> 'deliveryDays'));
  if not (public.config_text_ok(p_rate -> 'city', 60, true)
          and public.config_integer_ok(p_rate -> 'distanceKm', 0, 3000)
          and public.config_number_ok(p_rate -> 'baseFee', 0, 1000)
          and public.config_number_ok(p_rate -> 'includedKg', 0, 100)
          and public.config_number_ok(p_rate -> 'extraPerKg', 0, 1000)
          and public.config_string_ok(p_rate -> 'deliveryDays', 20)
          and coalesce(jsonb_typeof(p_rate -> 'active') = 'boolean', false)
          and (coalesce(jsonb_typeof(p_rate -> 'maxFee'), 'null') = 'null' or public.config_integer_ok(p_rate -> 'maxFee', 0, 1000))) then
    raise exception 'invalid_rate';
  end if;
  v_max := (p_rate ->> 'maxFee')::numeric;
  if p_seen is not null and not (p_rate ? 'maxFee') then
    v_max := (select r.max_fee from public.shipping_rates r where r.id = v_id);
  end if;
  if v_max < (p_rate ->> 'baseFee')::numeric then
    raise exception 'invalid_rate';
  end if;
  if p_seen is null then
    if exists (select 1 from public.shipping_rates where id = v_id) then
      raise exception 'exists';
    end if;
    insert into public.shipping_rates (id, city, distance_km, base_fee, included_kg, extra_per_kg, max_fee, delivery_days, active)
    values (v_id, p_rate -> 'city', (p_rate ->> 'distanceKm')::numeric::integer, (p_rate ->> 'baseFee')::numeric, (p_rate ->> 'includedKg')::numeric,
            (p_rate ->> 'extraPerKg')::numeric, v_max, p_rate ->> 'deliveryDays', false);
  else
    update public.shipping_rates
       set city = p_rate -> 'city', distance_km = (p_rate ->> 'distanceKm')::numeric::integer, base_fee = (p_rate ->> 'baseFee')::numeric,
           included_kg = (p_rate ->> 'includedKg')::numeric, extra_per_kg = (p_rate ->> 'extraPerKg')::numeric, max_fee = v_max,
           delivery_days = p_rate ->> 'deliveryDays', active = (p_rate ->> 'active')::boolean
     where id = v_id and updated_at = p_seen;
    if not found then
      if exists (select 1 from public.shipping_rates where id = v_id) then
        raise exception 'stale';
      end if;
      -- an id that does not exist: never a way to rename a city
      raise exception 'not_found';
    end if;
  end if;
  perform public.config_saved('shipping_rate', v_id);
  return v_id;
end $$;

-- ───────────── 4. The gate where orders and B2B requests are written ─────────────
-- check_order (20260927000000_init.sql) with three changes: the gate first, an origin without a price is
-- never in a Custom Blend, and the delivery fee stops at the city's cap. Everything else is unchanged.
-- check_order, commit_order and commit_quote_request now also list pg_temp last in their search_path.
create or replace function public.check_order(p_order jsonb)
returns jsonb
language plpgsql stable set search_path = public, pg_temp as $$
declare
  s           jsonb := (select settings from public.site_config where id = 1);
  v_line      jsonb;
  v_part      jsonb;
  v_product   public.products;
  v_origin    public.origins;
  v_rate      public.shipping_rates;
  v_size      numeric;
  v_qty       numeric;
  v_unit      numeric;
  v_expected  numeric;
  v_percent   numeric;
  v_total_pct numeric;
  v_count     integer;
  v_subtotal  numeric := 0;
  v_weight    numeric := 0;
  v_fee       numeric;
  v_extra_kg  numeric;
  v_free      numeric := coalesce((s ->> 'freeShippingOver')::numeric, 0);
  v_loss      numeric := coalesce((s ->> 'roastLossPercent')::numeric, 0);
  v_min_pct   numeric := coalesce((s #>> '{customBlend,minPercent}')::numeric, 5);
  v_max_orig  numeric := coalesce((s #>> '{customBlend,maxOrigins}')::numeric, 4);
  v_need      jsonb := '{}'::jsonb;   -- originId -> size × percent × bags, whole numbers
  v_result    jsonb := '[]'::jsonb;
  v_lines     jsonb := '[]'::jsonb;
  v_built     jsonb;
  v_comp      jsonb;
  v_given     numeric;
  v_kg        numeric;
  k           text;
  -- the white space of JavaScript's trim() and \s (src/core/validation.ts), whatever
  -- the database locale: \s alone would follow it
  v_ws        constant text := '\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff';
  v_trim      constant text := '^[' || v_ws || ']+|[' || v_ws || ']+$';
  v_name      text := regexp_replace(coalesce(p_order #>> '{customer,fullName}', ''), v_trim, '', 'g');
  v_address   text := regexp_replace(coalesce(p_order #>> '{customer,address}', ''), v_trim, '', 'g');
  v_email     text := regexp_replace(coalesce(p_order #>> '{customer,email}', ''), v_trim, '', 'g');
  v_phone     text := regexp_replace(coalesce(p_order #>> '{customer,phone}', ''), '[' || v_ws || '.\-()]', '', 'g');
begin
  -- nothing is sold before the owner opens the sales (set_sales_open); a missing setting = closed
  if s -> 'salesOpen' is distinct from 'true'::jsonb then
    raise exception 'sales_closed';
  end if;
  if s is null or v_loss < 0 or v_loss >= 100 then
    raise exception 'invalid_order:settings';
  end if;
  if coalesce(p_order ->> 'locale', 'fr') not in ('ar', 'fr', 'en') then
    raise exception 'invalid_order:locale';
  end if;
  -- customer (src/core/order.ts validateCustomer, src/core/validation.ts); lengths
  -- count characters, as src/core/validation.ts charCount does; the upper limits are
  -- the form's (TEXT_MAX) and the table's
  if char_length(v_name) not between 3 and 80 then
    raise exception 'invalid_order:name';
  end if;
  if v_phone !~ '^(\+212|00212|0)[5-7][0-9]{8}$' then
    raise exception 'invalid_order:phone';
  end if;
  if char_length(v_email) > 120 or v_email <> '' and v_email !~ ('^[^' || v_ws || '@]+@[^' || v_ws || '@]+\.[^' || v_ws || '@]{2,}$') then
    raise exception 'invalid_order:email';
  end if;
  if char_length(v_address) not between 6 and 200 then
    raise exception 'invalid_order:address';
  end if;
  if char_length(coalesce(p_order #>> '{customer,company}', '')) > 80
     or char_length(coalesce(p_order #>> '{customer,notes}', '')) > 500 then
    raise exception 'invalid_order:text_too_long';
  end if;

  if jsonb_typeof(p_order -> 'lines') is distinct from 'array' or jsonb_array_length(p_order -> 'lines') = 0 then
    raise exception 'invalid_order:lines';
  end if;
  for v_line in select value from jsonb_array_elements(p_order -> 'lines') loop
    -- bag size and quantity (src/core/cart.ts PACK_SIZES, isValidQty: 1 to 100 bags)
    if jsonb_typeof(v_line -> 'size') is distinct from 'number' or jsonb_typeof(v_line -> 'qty') is distinct from 'number'
       or jsonb_typeof(v_line -> 'unitPrice') is distinct from 'number' or jsonb_typeof(v_line -> 'lineTotal') is distinct from 'number'
       or jsonb_typeof(v_line -> 'composition') is distinct from 'array' then
      raise exception 'invalid_order:line';
    end if;
    v_size := (v_line ->> 'size')::numeric;
    v_qty  := (v_line ->> 'qty')::numeric;
    v_unit := (v_line ->> 'unitPrice')::numeric;
    if v_size not in (250, 500, 1000) then
      raise exception 'invalid_order:size';
    end if;
    if v_qty <> trunc(v_qty) or v_qty < 1 or v_qty > 100 then
      raise exception 'invalid_order:qty';
    end if;

    if v_line ->> 'kind' = 'product' then
      select * into v_product from public.products where id = v_line ->> 'productId' and active;
      if not found then
        raise exception 'invalid_order:product';
      end if;
      -- the price of this size, a real price (src/core/pricing.ts productPrice, isPrice)
      v_expected := case when jsonb_typeof(v_product.prices -> v_size::integer::text) = 'number'
                         then (v_product.prices ->> v_size::integer::text)::numeric end;
      if v_expected is null or v_expected < 1 then
        raise exception 'invalid_order:size_not_offered';
      end if;
      -- a B2B blend's 1 kg bag goes only in a cart above the threshold, which is a quote,
      -- never an order (src/core/cart.ts isBulkOnly); 250 g and 500 g are paid samples
      if v_product.kind = 'b2b' and v_size = 1000 then
        raise exception 'invalid_order:bulk_only';
      end if;
      if v_unit <> v_expected then
        raise exception 'invalid_order:price';
      end if;
      -- the composition is the product's recipe, nothing else
      if jsonb_array_length(v_line -> 'composition') <> (select count(*) from public.product_recipes where product_id = v_product.id)
         or exists (select 1 from public.product_recipes r
                     where r.product_id = v_product.id
                       and not exists (select 1 from jsonb_array_elements(v_line -> 'composition') c
                                        where c ->> 'originId' = r.origin_id
                                          and jsonb_typeof(c -> 'percent') = 'number'
                                          and (c ->> 'percent')::numeric = r.percent)) then
        raise exception 'invalid_order:composition';
      end if;
      v_built := jsonb_build_object('kind', 'product', 'productId', v_product.id, 'name', v_product.name);
    elsif v_line ->> 'kind' = 'custom' then
      -- Custom Blend (src/core/blend.ts validateBlend, pricing.ts customBlendPrice)
      if coalesce((s #>> '{customBlend,enabled}')::boolean, false) is not true then
        raise exception 'invalid_order:blend_paused';
      end if;
      v_count := jsonb_array_length(v_line -> 'composition');
      if v_count = 0 or v_count > v_max_orig
         or (select count(distinct c ->> 'originId') from jsonb_array_elements(v_line -> 'composition') c) <> v_count then
        raise exception 'invalid_order:blend';
      end if;
      v_total_pct := 0;
      v_expected := coalesce((s #>> array['customBlend', 'feeBySize', v_size::integer::text])::numeric, 0);
      for v_part in select value from jsonb_array_elements(v_line -> 'composition') loop
        if jsonb_typeof(v_part -> 'percent') is distinct from 'number' then
          raise exception 'invalid_order:blend';
        end if;
        v_percent := (v_part ->> 'percent')::numeric;
        if v_percent <> trunc(v_percent) or v_percent < v_min_pct then
          raise exception 'invalid_order:blend';
        end if;
        select * into v_origin from public.origins where id = v_part ->> 'originId';
        if not found or not v_origin.active or not v_origin.custom_blend_enabled or v_origin.price_per_kg is null or v_origin.price_per_kg < 1 then
          raise exception 'invalid_order:blend_origin';
        end if;
        v_total_pct := v_total_pct + v_percent;
        v_expected := v_expected + v_origin.price_per_kg * (v_size * v_percent / 100) / 1000;
      end loop;
      if v_total_pct <> 100 then
        raise exception 'invalid_order:blend';
      end if;
      v_expected := round(v_expected);
      if v_expected < 1 or v_unit <> v_expected then
        raise exception 'invalid_order:price';
      end if;
      -- the name of every Custom Blend line (src/core/cart.ts CUSTOM_BLEND_NAME)
      v_built := jsonb_build_object('kind', 'custom', 'name',
        jsonb_build_object('ar', 'خلطتي الخاصة', 'fr', 'Mon Custom Blend', 'en', 'My Custom Blend'));
    else
      raise exception 'invalid_order:kind';
    end if;

    if (v_line ->> 'lineTotal')::numeric <> round(v_expected * v_qty) then
      raise exception 'invalid_order:line_total';
    end if;
    v_subtotal := v_subtotal + round(v_expected * v_qty);
    v_weight := v_weight + v_size / 1000 * v_qty;
    -- stock this line needs (src/core/stock.ts kgNeeded: kept whole here and divided once
    -- per origin below, so 16 % roasting loss cannot make 0.0625 kg 0.06249…), and the grams of each origin in
    -- one bag (src/core/recipe.ts composition): percents are whole, so no rounding
    v_comp := '[]'::jsonb;
    for v_part in select value from jsonb_array_elements(v_line -> 'composition') loop
      v_percent := (v_part ->> 'percent')::numeric;
      v_need := jsonb_set(v_need, array[v_part ->> 'originId'],
        to_jsonb(coalesce((v_need ->> (v_part ->> 'originId'))::numeric, 0) + v_size * v_percent * v_qty));
      v_comp := v_comp || jsonb_build_object('originId', v_part ->> 'originId', 'percent', trim_scale(v_percent),
                                             'grams', trim_scale(v_size * v_percent / 100));
    end loop;
    v_lines := v_lines || (v_built || jsonb_build_object(
      'size', v_size::integer, 'qty', v_qty::integer, 'unitPrice', v_expected,
      'lineTotal', round(v_expected * v_qty), 'composition', v_comp));
  end loop;

  if jsonb_typeof(p_order -> 'subtotal') is distinct from 'number' or (p_order ->> 'subtotal')::numeric <> round(v_subtotal) then
    raise exception 'invalid_order:subtotal';
  end if;
  if jsonb_typeof(p_order -> 'weightKg') is distinct from 'number' or (p_order ->> 'weightKg')::numeric <> round(v_weight, 3) then
    raise exception 'invalid_order:weight';
  end if;
  -- above the B2B limit the order is a quote, not a cart (src/core/cart.ts isB2B)
  if v_weight > coalesce((s ->> 'b2bThresholdKg')::numeric, 10) then
    raise exception 'invalid_order:b2b';
  end if;
  -- delivery (src/core/shipping.ts shippingFee)
  select * into v_rate from public.shipping_rates where id = p_order #>> '{customer,cityId}' and active;
  if not found then
    raise exception 'invalid_order:city';
  end if;
  if v_free > 0 and round(v_subtotal) >= v_free then
    v_fee := 0;
  else
    v_extra_kg := greatest(0, ceil(round(v_weight, 3) - v_rate.included_kg - 0.000000001));
    -- at most the city's cap (least() skips a null max_fee: no cap)
    v_fee := round(least(v_rate.base_fee + v_extra_kg * v_rate.extra_per_kg, v_rate.max_fee));
  end if;
  if jsonb_typeof(p_order -> 'shippingFee') is distinct from 'number' or (p_order ->> 'shippingFee')::numeric <> v_fee then
    raise exception 'invalid_order:shipping';
  end if;
  if jsonb_typeof(p_order -> 'total') is distinct from 'number' or (p_order ->> 'total')::numeric <> round(v_subtotal) + v_fee then
    raise exception 'invalid_order:total';
  end if;
  if not exists (select 1 from public.payment_methods where id = p_order ->> 'paymentMethod' and enabled) then
    raise exception 'invalid_order:payment_method';
  end if;
  -- transfer and Cash Plus only once the owner entered the real details, so no
  -- customer is sent to pay nowhere (src/core/orderFlow.ts payeeReady)
  if (p_order ->> 'paymentMethod' = 'bank_transfer'
      and exists (select 1 from unnest(array[s #>> '{bank,holder}', s #>> '{bank,bankName}', s #>> '{bank,rib}']) v
                   where regexp_replace(coalesce(v, ''), v_trim, '', 'g') = ''))
     or (p_order ->> 'paymentMethod' = 'cashplus'
      and regexp_replace(coalesce(s #>> '{cashplus,beneficiary}', ''), v_trim, '', 'g') = '') then
    raise exception 'invalid_order:payment_details';
  end if;

  -- the stock to deduct is computed here; the browser's figures must be the same
  if jsonb_typeof(p_order -> 'stockDeductions') is distinct from 'array'
     or jsonb_array_length(p_order -> 'stockDeductions') <> (select count(*) from jsonb_object_keys(v_need))
     or (select count(distinct d ->> 'originId') from jsonb_array_elements(p_order -> 'stockDeductions') d)
        <> jsonb_array_length(p_order -> 'stockDeductions') then
    raise exception 'invalid_order:deductions';
  end if;
  for k in select jsonb_object_keys(v_need) loop
    select (d ->> 'kg')::numeric into v_given
      from jsonb_array_elements(p_order -> 'stockDeductions') d where d ->> 'originId' = k;
    -- kg = size × percent × bags / (1000 × (100 − loss %))
    v_kg := round((v_need ->> k)::numeric / (1000 * (100 - v_loss)), 3);
    if v_given is distinct from v_kg then
      raise exception 'invalid_order:deductions';
    end if;
    v_result := v_result || jsonb_build_object('originId', k, 'kg', v_kg);
  end loop;
  return jsonb_build_object(
    'customer', jsonb_build_object('fullName', v_name, 'phone', '+212' || right(v_phone, 9), 'email', v_email,
                                   'address', v_address),
    'lines', v_lines,
    'stockDeductions', v_result);
end $$;

-- commit_order (20261007080308_order_idempotency_commit.sql) with the gate before the number is taken.
create or replace function public.commit_order(p_order jsonb, p_whatsapp text, p_email text, p_subject text,
                                    p_idempotency_key uuid default null)
returns table (id uuid, number text, created boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  d          jsonb;
  v_checked  jsonb;
  v_deductions jsonb;
  v_origin   public.origins;
  v_id       uuid := gen_random_uuid();
  v_seq      bigint;
  v_number   text;
  v_constraint text;
begin
  -- the same submission again: the order it saved, untouched (no new check, stock or message)
  if p_idempotency_key is not null then
    return query select o.id, o.number, false from public.orders o where o.idempotency_key = p_idempotency_key;
    if found then
      return;
    end if;
  end if;
  -- the sales gate, under a lock on the settings row: set_sales_open waits for this sale to end,
  -- and no number is taken by a refused order
  perform 1 from public.site_config c where c.id = 1 and c.settings -> 'salesOpen' = 'true'::jsonb for share;
  if not found then
    raise exception 'sales_closed';
  end if;
  v_seq := nextval('public.order_number_seq');
  -- lpad would cut 10000 to '1000': pad to 4 digits, never shorten
  v_number := 'BC-' || to_char(now(), 'YYYY') || '-' || lpad(v_seq::text, greatest(4, length(v_seq::text)), '0');
  -- refuse anything that could add stock or be free before looking further
  if jsonb_typeof(p_order -> 'stockDeductions') is distinct from 'array'
     or jsonb_array_length(p_order -> 'stockDeductions') = 0
     or exists (select 1 from jsonb_array_elements(p_order -> 'stockDeductions') x
                where coalesce((x ->> 'kg')::numeric, 0) <= 0
                   or (x ->> 'kg')::numeric in ('NaN', 'Infinity')) then
    raise exception 'invalid_order';
  end if;
  -- everything else in the order is checked against the database; what is stored below
  -- (customer, lines, deductions) is what check_order rebuilt from it
  v_checked := public.check_order(p_order);
  v_deductions := v_checked -> 'stockDeductions';
  begin
    -- the order row first: a second call with the same key waits here until the first
    -- one ends, then lands in the handler below, before it could find the stock gone
    insert into public.orders (
      id, number, locale, customer_name, phone, email, city_id, address, company, notes,
      lines, weight_kg, subtotal, shipping_fee, total, payment_method, stock_deductions, idempotency_key
    ) values (
      v_id, v_number,
      coalesce(p_order ->> 'locale', 'fr'),
      v_checked #>> '{customer,fullName}',
      v_checked #>> '{customer,phone}',
      v_checked #>> '{customer,email}',
      p_order #>> '{customer,cityId}',
      v_checked #>> '{customer,address}',
      coalesce(p_order #>> '{customer,company}', ''),
      coalesce(p_order #>> '{customer,notes}', ''),
      v_checked -> 'lines',
      (p_order ->> 'weightKg')::numeric,
      (p_order ->> 'subtotal')::numeric,
      (p_order ->> 'shippingFee')::numeric,
      (p_order ->> 'total')::numeric,
      p_order ->> 'paymentMethod',
      v_deductions,
      p_idempotency_key
    );

    perform set_config('boga.stock_write', 'on', true);
    -- Lock every origin used, in a fixed order to avoid deadlocks.
    for d in
      select value from jsonb_array_elements(v_deductions) order by value ->> 'originId'
    loop
      select * into v_origin from public.origins o where o.id = d ->> 'originId' for update;
      if not found or not v_origin.active then
        raise exception 'out_of_stock:%', d ->> 'originId';
      end if;
      if v_origin.stock_kg < (d ->> 'kg')::numeric then
        raise exception 'out_of_stock:%', d ->> 'originId';
      end if;
      update public.origins o set stock_kg = o.stock_kg - (d ->> 'kg')::numeric where o.id = v_origin.id;
      insert into public.stock_movements (origin_id, delta_kg, reason, ref)
      values (v_origin.id, -((d ->> 'kg')::numeric), 'order', v_number);
    end loop;

    insert into public.order_events (order_id, label) values (v_id, 'order.created');
    perform public.queue_notification('order.created', replace(p_subject, '{number}', v_number),
                                      replace(p_whatsapp, '{number}', v_number), replace(p_email, '{number}', v_number));
    perform set_config('boga.stock_write', '', true);
  exception when unique_violation then
    -- the same key sent twice at the same moment: this one waited for the other to
    -- commit; nothing it did in this block is kept
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint is distinct from 'orders_idempotency_key_key' then
      raise;
    end if;
    return query select o.id, o.number, false from public.orders o where o.idempotency_key = p_idempotency_key;
    return;
  end;
  return query select v_id, v_number, true;
end $$;

-- commit_quote_request (20261001180317_quote_requests.sql), the same.
create or replace function public.commit_quote_request(p_quote jsonb, p_whatsapp text, p_email text, p_subject text)
returns table (id uuid, number text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id     uuid := gen_random_uuid();
  v_seq    bigint;
  v_number text;
begin
  -- the sales gate, as in commit_order: under a lock on the settings row, before a number is taken
  perform 1 from public.site_config c where c.id = 1 and c.settings -> 'salesOpen' = 'true'::jsonb for share;
  if not found then
    raise exception 'sales_closed';
  end if;
  v_seq := nextval('public.quote_number_seq');
  v_number := 'QR-' || to_char(now(), 'YYYY') || '-' || lpad(v_seq::text, greatest(4, length(v_seq::text)), '0');
  if jsonb_typeof(p_quote -> 'lines') is distinct from 'array' or jsonb_array_length(p_quote -> 'lines') = 0 then
    raise exception 'invalid_quote:lines';
  end if;
  insert into public.quote_requests (
    id, number, business_type, company, contact_name, phone, email, city_id, lines, weight_kg, indicative_total, notes
  ) values (
    v_id, v_number,
    p_quote ->> 'businessType',
    coalesce(p_quote ->> 'company', ''),
    p_quote ->> 'contactName',
    p_quote ->> 'phone',
    coalesce(p_quote ->> 'email', ''),
    p_quote ->> 'cityId',
    p_quote -> 'lines',
    (p_quote ->> 'weightKg')::numeric,
    (p_quote ->> 'indicativeTotal')::numeric,
    coalesce(p_quote ->> 'notes', '')
  );
  perform public.queue_notification('quote.created', replace(p_subject, '{number}', v_number),
                                    replace(p_whatsapp, '{number}', v_number), replace(p_email, '{number}', v_number));
  return query select v_id, v_number;
end $$;

-- ───────────── 5. save_product: the origins locked before its check ─────────────
-- The body of 20261013100000_catalog_trim with one change: every save locks the recipe's origins (for key share, in
-- id order) before checking they are shown and before writing the recipe. With save_origin's lock (for update, before
-- its 'origin_in_use' check), hiding an origin and showing a product made of it at the same instant can no longer
-- both pass: the second waits for the first, then refuses ('origin_in_use' or 'hidden_origin'). The id order also
-- keeps a save from deadlocking with an order taking the same origins, and key share (not share) with the expiry
-- cron's stock returns (supabase/tests/lock-stress.sh, lock-stress-expiry.sh).
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
  -- the recipe's origins, locked first and in id order like every path that locks several (commit_order, the stock
  -- returns): an origin being hidden by save_origin (for update) at the same instant is waited for, then read as it
  -- was committed; and the recipe rows written below take their own key share locks on origins already held, in no
  -- other order (in the order the page sent them, they could wait on an order in progress that waits on them).
  -- key share, the lock those rows take anyway: it never waits on a stock update (an order, the expiry cron)
  perform 1 from public.origins o where o.id in (select l ->> 'originId' from jsonb_array_elements(p_recipe) l) order by o.id for key share;
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
