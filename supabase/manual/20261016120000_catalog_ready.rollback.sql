-- ROLLBACK of 20261016120000_catalog_ready (P5 slice 12), CATALOG PART ONLY. Supabase SQL Editor, ONE transaction, on a computer.
-- Run it ONLY if the optional origin price, the whole-definition save_origin or the delivery cap must be undone.
--
-- WHAT IT UNDOES: save_origin back to 20261013100000_catalog_trim (price, alert level, Custom Blend only), save_shipping_rate
-- back to 20261013090048_config_trim (no cap), check_order without the cap, the column shipping_rates.max_fee dropped,
-- origins.price_per_kg required again (its constraint origins_active_needs_price dropped).
-- WHAT IT KEEPS, on purpose: THE SALES GATE (check_order, commit_order and commit_quote_request still refuse every sale
-- while settings.salesOpen is not true, and set_sales_open stays). Removing the gate would open the sales again: that is
-- a separate decision of the owner, never a side effect of a rollback.
-- WHEN IT REFUSES ("stop:", nothing changed): an origin without a price (the column cannot be required again without
-- making a price up: give every origin its real price first, or keep the migration and fix forward), or a city with a
-- cap (the cap would silently disappear and the fees would change: remove the caps first, knowingly). In practice this
-- rollback works between applying the migration and the cleanup that removes the example prices; after that, fix forward.
-- BEFORE: close the sales (Admin -> Settings) if they are open: an order saved while it runs stops it ("a row changed").
-- THE SITE: revert the code of slice 12 too (a revert commit, no history rewrite): the reverted code reads and sends
-- what these functions expect again.
--
-- HOW: paste ALL of it (from "begin;" to the last select), select nothing, press Run. Any check that fails raises an
-- exception ("stop:") and nothing is changed. RESULT: bodies_restored 3, gate_kept true, price_required true,
-- cap_column false, and the same products / origins / cities counts as before.
-- AFTER: the history row of version 20261016120000 is removed in a separate step (as for the earlier rollbacks).
-- Tests: tests/manual-sql.test.ts keeps the restored bodies equal to the ones of their migrations.

begin;
set local lock_timeout = '3s';

create temp table _before on commit drop as
  select (select md5(coalesce(string_agg(to_jsonb(p)::text, '|' order by id), '')) from public.products p) as products,
         (select md5(coalesce(string_agg(to_jsonb(r)::text, '|' order by product_id, origin_id), '')) from public.product_recipes r) as recipes,
         (select md5(coalesce(string_agg(to_jsonb(o)::text, '|' order by id), '')) from public.origins o) as origins,
         (select md5(coalesce(string_agg((to_jsonb(s) - 'max_fee')::text, '|' order by id), '')) from public.shipping_rates s) as rates,
         (select md5(coalesce(string_agg(to_jsonb(m)::text, '|' order by id), '')) from public.payment_methods m) as methods,
         (select md5(to_jsonb(c)::text) from public.site_config c where id = 1) as config,
         (select count(*) from public.orders) + (select count(*) from public.quote_requests) as sales;

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'shipping_rates' and column_name = 'max_fee') then
    raise exception 'stop: 20261016120000_catalog_ready is not applied (nothing to undo)';
  end if;
  -- what it undoes is exactly this migration (a later fix-forward is never reverted unseen)
  if (select md5(replace(prosrc, E'\r', '')) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'check_order') is distinct from '61d01c4019b75e4dab30773f9dd27f6d'
     or (select md5(replace(prosrc, E'\r', '')) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'commit_order') is distinct from '470f0947d3666b6c6ab3ecaaafe4d1c4'
     or (select md5(replace(prosrc, E'\r', '')) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'commit_quote_request') is distinct from '7fb8abd19c7f317919f3bb11cc72807e'
     or (select md5(replace(prosrc, E'\r', '')) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'save_origin') is distinct from '63810f494476dc81515e997212dc1ce4'
     or (select md5(replace(prosrc, E'\r', '')) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'save_shipping_rate') is distinct from '55f2f37a662eef940553a8ea3e2b711d'
     or (select md5(replace(prosrc, E'\r', '')) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'set_sales_open') is distinct from '12536c717475c55bffc615eae54eab8d' then
    raise exception 'stop: a function is not the one of 20261016120000_catalog_ready (changed since): tell Claude before going on';
  end if;
  if exists (select 1 from public.origins where price_per_kg is null) then
    raise exception 'stop: % origin(s) without a price: the price cannot be required again without making one up', (select count(*) from public.origins where price_per_kg is null);
  end if;
  if exists (select 1 from public.shipping_rates where max_fee is not null) then
    raise exception 'stop: % city(ies) with a delivery cap: dropping it would change their fees; remove the caps first, knowingly', (select count(*) from public.shipping_rates where max_fee is not null);
  end if;
end $$;

-- >>> save_origin of 20261013100000_catalog_trim.sql
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
-- <<< save_origin

-- >>> save_shipping_rate of 20261013090048_config_trim.sql
create or replace function public.save_shipping_rate(p_rate jsonb, p_seen timestamptz) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id text := p_rate ->> 'id';
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
          and coalesce(jsonb_typeof(p_rate -> 'active') = 'boolean', false)) then
    raise exception 'invalid_rate';
  end if;
  if p_seen is null then
    if exists (select 1 from public.shipping_rates where id = v_id) then
      raise exception 'exists';
    end if;
    insert into public.shipping_rates (id, city, distance_km, base_fee, included_kg, extra_per_kg, delivery_days, active)
    values (v_id, p_rate -> 'city', (p_rate ->> 'distanceKm')::numeric::integer, (p_rate ->> 'baseFee')::numeric, (p_rate ->> 'includedKg')::numeric,
            (p_rate ->> 'extraPerKg')::numeric, p_rate ->> 'deliveryDays', false);
  else
    update public.shipping_rates
       set city = p_rate -> 'city', distance_km = (p_rate ->> 'distanceKm')::numeric::integer, base_fee = (p_rate ->> 'baseFee')::numeric,
           included_kg = (p_rate ->> 'includedKg')::numeric, extra_per_kg = (p_rate ->> 'extraPerKg')::numeric,
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
-- <<< save_shipping_rate

-- >>> check_order of 20261016120000_catalog_ready.sql without the cap (the gate stays)
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
    v_fee := round(v_rate.base_fee + v_extra_kg * v_rate.extra_per_kg);
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
-- <<< check_order

alter table public.origins drop constraint origins_active_needs_price;
alter table public.origins alter column price_per_kg set not null;
alter table public.shipping_rates drop column max_fee;

do $$
declare
  b record;
begin
  select * into b from _before;
  if (select md5(coalesce(string_agg(to_jsonb(p)::text, '|' order by id), '')) from public.products p) is distinct from b.products
     or (select md5(coalesce(string_agg(to_jsonb(r)::text, '|' order by product_id, origin_id), '')) from public.product_recipes r) is distinct from b.recipes
     or (select md5(coalesce(string_agg(to_jsonb(o)::text, '|' order by id), '')) from public.origins o) is distinct from b.origins
     or (select md5(coalesce(string_agg((to_jsonb(s) - 'max_fee')::text, '|' order by id), '')) from public.shipping_rates s) is distinct from b.rates
     or (select md5(coalesce(string_agg(to_jsonb(m)::text, '|' order by id), '')) from public.payment_methods m) is distinct from b.methods
     or (select md5(to_jsonb(c)::text) from public.site_config c where id = 1) is distinct from b.config
     or (select count(*) from public.orders) + (select count(*) from public.quote_requests) <> b.sales then
    raise exception 'stop: a catalog, delivery, payment-method or settings row changed, or a sale was saved meanwhile: nothing is kept, run it again';
  end if;
  if (select is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'origins' and column_name = 'price_per_kg') <> 'NO'
     or exists (select 1 from pg_constraint where conname = 'origins_active_needs_price')
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'shipping_rates' and column_name = 'max_fee') then
    raise exception 'stop: the schema is not the one before 20261016120000 (price required, no constraint, no cap column)';
  end if;
  -- restored bodies are their migrations'; the gate's three bodies and the switch are untouched
  if (select md5(replace(prosrc, E'\r', '')) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'save_origin') is distinct from '474c8f441e0f30db554ecbaa0837a5e7'
     or (select md5(replace(prosrc, E'\r', '')) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'save_shipping_rate') is distinct from '3b3785b0564417180052f22fb0902554'
     or (select md5(replace(prosrc, E'\r', '')) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'check_order') is distinct from 'fb3b0aaa8adb57b78e4977e07c083bd9'
     or (select md5(replace(prosrc, E'\r', '')) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'commit_order') is distinct from '470f0947d3666b6c6ab3ecaaafe4d1c4'
     or (select md5(replace(prosrc, E'\r', '')) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'commit_quote_request') is distinct from '7fb8abd19c7f317919f3bb11cc72807e'
     or (select md5(replace(prosrc, E'\r', '')) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'set_sales_open') is distinct from '12536c717475c55bffc615eae54eab8d' then
    raise exception 'stop: a function body is not the expected one';
  end if;
  if has_function_privilege('anon', 'public.set_sales_open(boolean, text)', 'execute')
     or not has_function_privilege('authenticated', 'public.set_sales_open(boolean, text)', 'execute')
     or has_function_privilege('anon', 'public.save_origin(jsonb, timestamptz)', 'execute')
     or not has_function_privilege('authenticated', 'public.save_origin(jsonb, timestamptz)', 'execute')
     or has_function_privilege('anon', 'public.save_shipping_rate(jsonb, timestamptz)', 'execute')
     or not has_function_privilege('authenticated', 'public.save_shipping_rate(jsonb, timestamptz)', 'execute')
     or has_function_privilege('anon', 'public.commit_order(jsonb, text, text, text, uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.commit_order(jsonb, text, text, text, uuid)', 'execute')
     or not has_function_privilege('service_role', 'public.commit_order(jsonb, text, text, text, uuid)', 'execute')
     or has_function_privilege('anon', 'public.commit_quote_request(jsonb, text, text, text)', 'execute')
     or has_function_privilege('authenticated', 'public.commit_quote_request(jsonb, text, text, text)', 'execute')
     or not has_function_privilege('service_role', 'public.commit_quote_request(jsonb, text, text, text)', 'execute')
     or has_function_privilege('anon', 'public.check_order(jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.check_order(jsonb)', 'execute') then
    raise exception 'stop: the rights on the functions are not the expected ones';
  end if;
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
       and proname in ('commit_order', 'commit_quote_request', 'save_origin', 'save_shipping_rate', 'set_sales_open')
       and prosecdef and proconfig = array['search_path=public, pg_temp']) <> 5
     or (select proconfig from pg_proc where pronamespace = 'public'::regnamespace and proname = 'check_order') is distinct from array['search_path=public, pg_temp'] then
    raise exception 'stop: a function does not have its fixed search_path (public, pg_temp), or a writing one is not security definer';
  end if;
end $$;

commit;

-- result, after the commit (nothing else is selected)
select
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('save_origin', 'save_shipping_rate', 'check_order') and prosrc not like '%max_fee%' and prosrc not like '%needs_price%') as bodies_restored,
  (select count(*) = 3 from pg_proc where pronamespace = 'public'::regnamespace and proname in ('check_order', 'commit_order', 'commit_quote_request') and prosrc like '%sales_closed%') as gate_kept,
  (select is_nullable = 'NO' from information_schema.columns where table_schema = 'public' and table_name = 'origins' and column_name = 'price_per_kg') as price_required,
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'shipping_rates' and column_name = 'max_fee') as cap_column,
  (select count(*) from public.products) as products,
  (select count(*) from public.origins) as origins,
  (select count(*) from public.shipping_rates) as cities;
