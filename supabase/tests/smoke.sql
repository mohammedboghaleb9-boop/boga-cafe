-- Smoke test of the BOGA CAFÉ schema. Every block raises an exception if a rule is broken.
-- A signed-in user = request.jwt.claims, as the API sets it: the user (sub) and, for an
-- admin, aal2 (second factor passed; supabase/tests/aal.sql tests aal1).
\set ON_ERROR_STOP on
set client_min_messages = warning;

-- Seed ------------------------------------------------------------------
insert into auth.users values ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002');
insert into auth.users values ('00000000-0000-0000-0000-000000000003');
insert into public.admin_users values
  ('00000000-0000-0000-0000-000000000001', 'owner', 'Owner'),
  ('00000000-0000-0000-0000-000000000002', 'staff', 'Staff'),
  ('00000000-0000-0000-0000-000000000003', 'manager', 'Manager');
insert into public.admin_config values (1, '+212600000000', 'admin@example.com', true, true);
insert into public.site_config values (1, '{"b2bThresholdKg": 10, "unpaidOrderTimeoutHours": 48, "paymentCheckTimeoutHours": 120, "bank": {"holder": "Test holder", "bankName": "Test bank", "rib": "OWNER-RIB"}, "cashplus": {"beneficiary": ""}}', '{}');
insert into public.origins (id, name, country_code, species, roast_level, stock_kg, low_stock_kg, price_per_kg) values
  ('brazil',  '{"fr": "Brésil"}',  'BR', 'arabica', 'medium', 10, 2, 220),
  ('vietnam', '{"fr": "Viêt Nam"}', 'VN', 'robusta', 'dark',   1, 0.5, 150);
insert into public.shipping_rates (id, city, base_fee) values ('oujda', '{"fr": "Oujda"}', 20);
insert into public.payment_methods (id, label) values ('card', '{"fr": "Carte"}'), ('bank_transfer', '{"fr": "Virement"}');
insert into public.payment_methods (id, label, enabled) values ('cashplus', '{"fr": "Cash Plus"}', false);
insert into public.shipping_rates (id, city, base_fee, active) values ('nador', '{"fr": "Nador"}', 30, false);
begin;
insert into public.products (id, slug, kind, name, roast_level, prices, active)
values ('signature', 'signature', 'signature', '{"fr": "Signature"}', 'medium', '{"1000": 225}', true);
insert into public.product_recipes values ('signature', 'brazil', 80), ('signature', 'vietnam', 20);
insert into public.products (id, slug, kind, name, roast_level, prices, active)
values ('so-brazil', 'so-brazil', 'single-origin', '{"fr": "Brésil"}', 'medium', '{"250": 60, "500": 110, "1000": 220}', true);
insert into public.product_recipes values ('so-brazil', 'brazil', 100);
insert into public.products (id, slug, kind, name, roast_level, prices, active)
values ('retired', 'retired', 'single-origin', '{"fr": "Ancien"}', 'medium', '{"250": 60}', false);
insert into public.product_recipes values ('retired', 'brazil', 100);
insert into public.products (id, slug, kind, name, roast_level, prices, active)
values ('horeca', 'horeca', 'b2b', '{"fr": "Horeca"}', 'dark', '{"250": 45, "500": 80, "1000": 150}', true);
insert into public.product_recipes values ('horeca', 'brazil', 100);
commit;

-- A real order for these tests: bags of one product delivered in Oujda, built from the
-- catalog the way the site builds it (commit_order checks every figure in it).
create function pg_temp.test_order(p_product text, p_size integer, p_qty integer, p_payment text, p_name text default 'Client Test')
returns jsonb language sql as $$
  select jsonb_build_object(
    'locale', 'fr',
    'customer', jsonb_build_object('fullName', p_name, 'phone', '+212612345678', 'cityId', 'oujda', 'address', '12 rue Test'),
    'lines', jsonb_build_array(jsonb_build_object(
      'kind', 'product', 'productId', p_product, 'name', jsonb_build_object('fr', p_product), 'size', p_size, 'qty', p_qty,
      'unitPrice', price, 'lineTotal', price * p_qty,
      'composition', (select jsonb_agg(jsonb_build_object('originId', origin_id, 'percent', percent, 'grams', p_size * percent / 100.0))
                        from public.product_recipes where product_id = p_product))),
    'weightKg', p_size * p_qty / 1000.0,
    'subtotal', price * p_qty, 'shippingFee', fee, 'total', price * p_qty + fee,
    'paymentMethod', p_payment,
    'stockDeductions', (select jsonb_agg(jsonb_build_object('originId', origin_id, 'kg', round(p_size / 1000.0 * percent / 100.0 * p_qty, 3)))
                          from public.product_recipes where product_id = p_product))
  from (select (prices ->> p_size::text)::numeric as price from public.products where id = p_product) pr,
       (select base_fee as fee from public.shipping_rates where id = 'oujda') r
$$;

-- 1. A recipe that does not add up to 100 % is refused -------------------
do $$ begin
  begin
    insert into public.products (id, slug, kind, name, roast_level) values ('bad', 'bad', 'signature', '{}', 'medium');
    insert into public.product_recipes values ('bad', 'brazil', 90);
    set constraints all immediate;
    raise exception 'TEST FAILED: recipe of 90 %% accepted';
  exception when others then
    if sqlerrm like 'TEST FAILED%' then raise; end if;
  end;
end $$;
select 'ok 1 - recipe must total 100 %' as result;

-- 2. commit_order deducts stock, logs movements, queues 2 notifications ---
select * from public.commit_order(
  pg_temp.test_order('signature', 1000, 1, 'card'),  -- 225 DH + 20 delivery; 0.8 kg Brazil, 0.2 kg Viet Nam
  'Nouvelle commande {number}', 'Nouvelle commande {number}', '[BOGA CAFÉ] Commande {number}');
do $$ begin
  if (select stock_kg from public.origins where id = 'brazil') <> 9.2 then raise exception 'TEST FAILED: brazil stock'; end if;
  if (select stock_kg from public.origins where id = 'vietnam') <> 0.8 then raise exception 'TEST FAILED: vietnam stock'; end if;
  if (select count(*) from public.stock_movements where reason = 'order') <> 2 then raise exception 'TEST FAILED: movements'; end if;
  if (select count(*) from public.notification_outbox where event = 'order.created') <> 2 then raise exception 'TEST FAILED: outbox'; end if;
  if not exists (select 1 from public.notification_outbox where body like 'Nouvelle commande BC-%-0001') then raise exception 'TEST FAILED: number in message'; end if;
end $$;
select 'ok 2 - order committed, stock deducted, notifications queued' as result;

-- 3. Not enough stock → nothing changes -----------------------------------
do $$ begin
  begin
    perform public.commit_order(pg_temp.test_order('signature', 1000, 6, 'card'), '', '', ''); -- needs 1.2 kg of Viet Nam, 0.8 left
    raise exception 'TEST FAILED: oversold';
  exception when others then
    if sqlerrm not like 'out_of_stock:vietnam%' then raise; end if;
  end;
  if (select stock_kg from public.origins where id = 'brazil') <> 9.2 then raise exception 'TEST FAILED: partial deduction'; end if;
  if (select count(*) from public.orders) <> 1 then raise exception 'TEST FAILED: order inserted'; end if;
end $$;
select 'ok 3 - out of stock refused atomically' as result;

-- 4. Anonymous visitor: reads catalog, cannot read or write orders --------
set role anon;
do $$ begin
  if (select count(*) from public.products) <> 3 then raise exception 'TEST FAILED: anon catalog'; end if; -- the retired one is hidden
  if (select count(*) from public.orders) <> 0 then raise exception 'TEST FAILED: anon sees orders'; end if;
  if (select count(*) from public.admin_config) <> 0 then raise exception 'TEST FAILED: anon sees admin config'; end if;
  begin
    insert into public.orders (number, customer_name, phone, city_id, address, lines, weight_kg, subtotal, shipping_fee, total, payment_method, stock_deductions)
    values ('HACK', 'x', 'x', 'oujda', 'x', '[]', 1, 0, 0, 0, 'card', '[]');
    raise exception 'TEST FAILED: anon inserted an order';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.commit_order('{}', '', '', '');
    raise exception 'TEST FAILED: anon called commit_order';
  exception when insufficient_privilege then null;
  end;
  if (select count(*) from public.get_order_public((select id from public.orders limit 1))) <> 0 then
    null; -- anon cannot list ids, so this returns nothing; checked with a real id below
  end if;
end $$;
reset role;
do $$
declare v_id uuid := (select id from public.orders limit 1);
begin
  set local role anon;
  if (select total from public.get_order_public(v_id)) <> 245 then raise exception 'TEST FAILED: order page'; end if;
  perform public.report_offline_payment(v_id, 'REF');  -- card order: must stay unchanged
  reset role;
  if (select payment_status from public.orders where id = v_id) <> 'pending' then raise exception 'TEST FAILED: card order reported'; end if;
end $$;
select 'ok 4 - anon: catalog yes, orders no, own order page yes' as result;

-- 5. Staff: cannot change prices, can cancel (stock returns once) ---------
set role authenticated;
set request.jwt.claims = '{"sub": "00000000-0000-0000-0000-000000000002", "aal": "aal2"}';
do $$
declare v_id uuid;
begin
  update public.products set prices = '{"1000": 1}' where id = 'signature';
  if (select prices ->> '1000' from public.products where id = 'signature') <> '225' then raise exception 'TEST FAILED: staff changed price'; end if;
  select id into v_id from public.orders limit 1;
  perform public.set_order_status(v_id, 'cancelled');
  begin
    perform public.set_order_status(v_id, 'cancelled');
    raise exception 'TEST FAILED: cancelled twice';
  exception when others then
    if sqlerrm <> 'closed' then raise; end if;
  end;
end $$;
reset role;
do $$ begin
  if (select stock_kg from public.origins where id = 'brazil') <> 10 then raise exception 'TEST FAILED: stock not returned'; end if;
  if (select stock_kg from public.origins where id = 'vietnam') <> 1 then raise exception 'TEST FAILED: vietnam not returned'; end if;
end $$;
select 'ok 5 - staff cannot edit prices; cancel returns stock exactly once' as result;

-- 6. Owner adjusts stock; low-stock alert is queued ------------------------
set role authenticated;
set request.jwt.claims = '{"sub": "00000000-0000-0000-0000-000000000001", "aal": "aal2"}';
select public.adjust_stock('vietnam', -0.7, 'correction', 'inventaire');
reset role;
do $$ begin
  if (select stock_kg from public.origins where id = 'vietnam') <> 0.3 then raise exception 'TEST FAILED: adjust'; end if;
  if (select count(*) from public.notification_outbox where event = 'stock.low') <> 2 then raise exception 'TEST FAILED: low stock alert'; end if;
  if (select actor from public.stock_movements where reason = 'correction') <> '00000000-0000-0000-0000-000000000001' then raise exception 'TEST FAILED: actor'; end if;
end $$;
select 'ok 6 - stock adjustment logged with author, low-stock alert queued' as result;

-- 7. commit_order refuses orders that could add stock or cost nothing; numbers go past 9999
do $$
declare bad text;
begin
  foreach bad in array array[
    '[{"originId": "brazil", "kg": -1}]',
    '[{"originId": "brazil", "kg": 0}]',
    '[]'
  ] loop
    begin
      perform public.commit_order(
        ('{"customer": {"fullName": "X", "phone": "1", "cityId": "oujda", "address": "a"}, "lines": [], "weightKg": 1,
          "subtotal": 10, "shippingFee": 0, "total": 10, "paymentMethod": "card", "stockDeductions": ' || bad || '}')::jsonb, '', '', '');
      raise exception 'TEST FAILED: accepted deductions %', bad;
    exception when others then
      if sqlerrm <> 'invalid_order' then raise; end if;
    end;
  end loop;
  begin
    perform public.commit_order(pg_temp.test_order('so-brazil', 250, 1, 'card') || '{"subtotal": -40, "total": -20}', '', '', '');
    raise exception 'TEST FAILED: negative total accepted';
  exception when others then
    if sqlerrm <> 'invalid_order:subtotal' then raise; end if;
  end;
  if (select stock_kg from public.origins where id = 'brazil') <> 10 then raise exception 'TEST FAILED: stock moved by a refused order'; end if;
  perform setval('public.order_number_seq', 9999);
  if (select number from public.commit_order(pg_temp.test_order('so-brazil', 250, 1, 'bank_transfer'), '', '', '')) not like 'BC-%-10000' then
    raise exception 'TEST FAILED: order 10000 numbering';
  end if;
end $$;
select 'ok 7 - no negative, empty or free orders; numbering past 9999' as result;

-- 8. Stock moves only through the functions (never a direct UPDATE) ---------
set role authenticated;
set request.jwt.claims = '{"sub": "00000000-0000-0000-0000-000000000001", "aal": "aal2"}';
do $$ begin
  begin
    update public.origins set stock_kg = 999 where id = 'brazil';
    raise exception 'TEST FAILED: direct stock update';
  exception when others then
    if sqlerrm <> 'stock_changes_go_through_functions' then raise; end if;
  end;
  update public.origins set price_per_kg = 230 where id = 'brazil'; -- other catalog fields stay editable
end $$;
reset role;
do $$ begin
  if (select price_per_kg from public.origins where id = 'brazil') <> 230 then raise exception 'TEST FAILED: price not editable'; end if;
end $$;
select 'ok 8 - stock only through logged functions' as result;

-- 9. Order and payment rules: no production before payment, owner records money
do $$
declare v_id uuid;
begin
  select id into v_id from public.orders where number like 'BC-%-10000';
  perform set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-000000000002", "aal": "aal2"}', true); -- staff
  set local role authenticated;
  perform public.set_order_status(v_id, 'confirmed');
  begin perform public.set_order_status(v_id, 'in_production'); raise exception 'TEST FAILED: produced unpaid';
  exception when others then if sqlerrm <> 'needs_payment' then raise; end if; end;
  begin perform public.set_order_status(v_id, 'delivered'); raise exception 'TEST FAILED: skipped steps';
  exception when others then if sqlerrm <> 'not_next' then raise; end if; end;
  begin perform public.set_payment_status(v_id, 'paid'); raise exception 'TEST FAILED: staff marked paid';
  exception when others then if sqlerrm <> 'forbidden' then raise; end if; end;
  perform set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-000000000003", "aal": "aal2"}', true); -- manager
  begin perform public.set_payment_status(v_id, 'paid'); raise exception 'TEST FAILED: manager marked paid';
  exception when others then if sqlerrm <> 'forbidden' then raise; end if; end;
  perform set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-000000000001", "aal": "aal2"}', true); -- owner
  begin perform public.set_payment_status(v_id, 'refunded'); raise exception 'TEST FAILED: refunded unpaid';
  exception when others then if sqlerrm <> 'invalid_transition' then raise; end if; end;
  perform public.set_payment_status(v_id, 'paid');
  perform public.set_order_status(v_id, 'in_production');
  begin perform public.set_order_status(v_id, 'cancelled'); raise exception 'TEST FAILED: cancelled in production';
  exception when others then if sqlerrm <> 'too_late_to_cancel' then raise; end if; end;
  reset role;
  if (select status from public.orders where id = v_id) <> 'in_production' then raise exception 'TEST FAILED: status'; end if;
end $$;
select 'ok 9 - no production before payment; only the owner records payments' as result;

-- 10. Bank details and rules: owner only; managers keep editing texts ---------
set role authenticated;
set request.jwt.claims = '{"sub": "00000000-0000-0000-0000-000000000003", "aal": "aal2"}';
do $$ begin
  begin
    update public.site_config set settings = jsonb_set(settings, '{bank,rib}', '"ATTACKER-RIB"') where id = 1;
    raise exception 'TEST FAILED: manager changed the RIB';
  exception when others then
    if sqlerrm <> 'owner_only' then raise; end if;
  end;
  update public.site_config set content = '{"heroTitle": {"fr": "Nouveau"}}' where id = 1;
end $$;
set request.jwt.claims = '{"sub": "00000000-0000-0000-0000-000000000001", "aal": "aal2"}';
update public.site_config set settings = jsonb_set(settings, '{bank,rib}', '"NEW-OWNER-RIB"') where id = 1;
reset role;
do $$ begin
  if (select settings #>> '{bank,rib}' from public.site_config) <> 'NEW-OWNER-RIB' then raise exception 'TEST FAILED: owner could not edit'; end if;
  if (select content #>> '{heroTitle,fr}' from public.site_config) <> 'Nouveau' then raise exception 'TEST FAILED: manager could not edit texts'; end if;
end $$;
select 'ok 10 - settings (bank) owner only, texts for managers' as result;

-- 11. Unpaid orders past the limit are cancelled and give their stock back ----
do $$
declare v_id uuid; v_before numeric;
begin
  select id into v_id from public.commit_order(pg_temp.test_order('so-brazil', 500, 1, 'bank_transfer', 'Late'), '', '', '');
  v_before := (select stock_kg from public.origins where id = 'brazil');
  if public.expire_unpaid_orders() <> 0 then raise exception 'TEST FAILED: expired a fresh order'; end if;
  update public.orders set created_at = now() - interval '49 hours' where id = v_id;
  if public.expire_unpaid_orders() <> 1 then raise exception 'TEST FAILED: late order not expired'; end if;
  if (select status from public.orders where id = v_id) <> 'cancelled' then raise exception 'TEST FAILED: not cancelled'; end if;
  if (select stock_kg from public.origins where id = 'brazil') <> v_before + 0.5 then raise exception 'TEST FAILED: stock not returned'; end if;
  if not exists (select 1 from public.order_events where order_id = v_id and label = 'status.expired') then raise exception 'TEST FAILED: event'; end if;
  if public.expire_unpaid_orders() <> 0 then raise exception 'TEST FAILED: expired twice'; end if;
end $$;
set role authenticated;
do $$ begin
  begin perform public.expire_unpaid_orders(); raise exception 'TEST FAILED: callable by users';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'ok 11 - unpaid orders expire, stock returns once, server-only' as result;

-- 12. adjust_stock logs the change that really happened (never under 0) ------
set role authenticated;
set request.jwt.claims = '{"sub": "00000000-0000-0000-0000-000000000001", "aal": "aal2"}';
select public.adjust_stock('vietnam', -5, 'correction', 'casse');
reset role;
do $$ begin
  if (select stock_kg from public.origins where id = 'vietnam') <> 0 then raise exception 'TEST FAILED: clamp'; end if;
  if (select delta_kg from public.stock_movements where note = 'casse') <> -0.3 then raise exception 'TEST FAILED: logged % instead of -0.3', (select delta_kg from public.stock_movements where note = 'casse'); end if;
end $$;
select 'ok 12 - stock history matches reality' as result;


-- 13. Cancelled orders: no late payment report; a refund is possible once, never mid-production
do $$
declare v_id uuid;
begin
  select id into v_id from public.commit_order(pg_temp.test_order('so-brazil', 250, 1, 'bank_transfer', 'Annule'), '', '', '');
  perform set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-000000000001", "aal": "aal2"}', true); -- owner
  set local role authenticated;
  perform public.set_order_status(v_id, 'cancelled');
  -- the cancel opened the stock gate for itself only: it is closed again right after
  begin
    update public.origins set stock_kg = 999 where id = 'brazil';
    raise exception 'TEST FAILED: stock gate left open after a cancel';
  exception when others then
    if sqlerrm <> 'stock_changes_go_through_functions' then raise; end if;
  end;
  set local role anon;
  perform public.report_offline_payment(v_id, 'LATE-REF');
  set local role authenticated;
  if (select payment_status from public.orders where id = v_id) <> 'pending' then raise exception 'TEST FAILED: payment reported on a cancelled order'; end if;
  -- money that arrives after the cancel can still be given back, once
  perform public.set_payment_status(v_id, 'refunded');
  begin perform public.set_payment_status(v_id, 'refunded'); raise exception 'TEST FAILED: refunded twice';
  exception when others then if sqlerrm <> 'invalid_transition' then raise; end if; end;
  -- a paid order in production is not refunded (it would stay stuck in production)
  begin
    perform public.set_payment_status((select id from public.orders where number like 'BC-%-10000'), 'refunded');
    raise exception 'TEST FAILED: refunded mid-production';
  exception when others then if sqlerrm <> 'invalid_transition' then raise; end if; end;
  reset role;
  if (select payment_status from public.orders where id = v_id) <> 'refunded' then raise exception 'TEST FAILED: refund'; end if;
end $$;
select 'ok 13 - cancelled orders: no late report, one refund, none mid-production' as result;

-- 14. Managers change the free-shipping threshold, never the contact details ----
set role authenticated;
set request.jwt.claims = '{"sub": "00000000-0000-0000-0000-000000000003", "aal": "aal2"}';
do $$ begin
  update public.site_config set settings = settings || '{"freeShippingOver": 600}' where id = 1;
  begin
    update public.site_config set settings = settings || '{"contact": {"whatsapp": "+212700000000"}}' where id = 1;
    raise exception 'TEST FAILED: manager changed the contact number';
  exception when others then
    if sqlerrm <> 'owner_only' then raise; end if;
  end;
end $$;
reset role;
do $$ begin
  if (select settings ->> 'freeShippingOver' from public.site_config) <> '600' then raise exception 'TEST FAILED: manager could not set free shipping'; end if;
  if (select settings -> 'contact' from public.site_config) is not null then raise exception 'TEST FAILED: contact changed'; end if;
end $$;
select 'ok 14 - managers: free shipping yes, contact details no' as result;

-- 15. A new origin created from the admin starts at 0 kg ----------------------
set role authenticated;
set request.jwt.claims = '{"sub": "00000000-0000-0000-0000-000000000003", "aal": "aal2"}';
do $$ begin
  begin
    insert into public.origins (id, name, country_code, species, roast_level, stock_kg, low_stock_kg, price_per_kg)
    values ('ghost', '{"fr": "Fantôme"}', 'ET', 'arabica', 'light', 50, 1, 200);
    raise exception 'TEST FAILED: origin created with stock outside the history';
  exception when others then
    if sqlerrm <> 'stock_changes_go_through_functions' then raise; end if;
  end;
  insert into public.origins (id, name, country_code, species, roast_level, stock_kg, low_stock_kg, price_per_kg)
  values ('ethiopia', '{"fr": "Éthiopie"}', 'ET', 'arabica', 'light', 0, 1, 260);
  perform public.adjust_stock('ethiopia', 5, 'restock', 'premier lot');
end $$;
reset role;
do $$ begin
  if (select stock_kg from public.origins where id = 'ethiopia') <> 5 then raise exception 'TEST FAILED: restock'; end if;
  if not exists (select 1 from public.stock_movements where origin_id = 'ethiopia' and reason = 'restock' and delta_kg = 5) then raise exception 'TEST FAILED: first lot not in history'; end if;
end $$;
select 'ok 15 - new origins start at 0 kg; first lot goes through the history' as result;

-- 16. A refund before production cancels the order and gives its coffee back --
do $$
declare v_id uuid; v_before numeric;
begin
  select id into v_id from public.commit_order(pg_temp.test_order('so-brazil', 250, 1, 'card', 'Rembourse'), '', '', '');
  v_before := (select stock_kg from public.origins where id = 'brazil');
  perform set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-000000000001", "aal": "aal2"}', true); -- owner
  set local role authenticated;
  perform public.set_payment_status(v_id, 'paid');      -- new → confirmed
  perform public.set_payment_status(v_id, 'refunded');  -- customer changed their mind
  reset role;
  if (select status from public.orders where id = v_id) <> 'cancelled' then raise exception 'TEST FAILED: refunded order left open'; end if;
  if (select stock_kg from public.origins where id = 'brazil') <> v_before + 0.25 then raise exception 'TEST FAILED: stock not returned on refund'; end if;
  if (select count(*) from public.order_events where order_id = v_id and label in ('payment.refunded', 'status.cancelled')) <> 2 then raise exception 'TEST FAILED: history'; end if;
end $$;
select 'ok 16 - a refund before production cancels the order and returns the stock' as result;

-- 17. The free-shipping threshold stays a number ------------------------------
set role authenticated;
set request.jwt.claims = '{"sub": "00000000-0000-0000-0000-000000000003", "aal": "aal2"}'; -- manager
do $$
declare bad text;
begin
  foreach bad in array array['{"freeShippingOver": "600"}', '{"freeShippingOver": -5}', '{"freeShippingOver": {"x": 1}}', '{"freeShippingOver": null}'] loop
    begin
      update public.site_config set settings = settings || bad::jsonb where id = 1;
      raise exception 'TEST FAILED: accepted %', bad;
    exception when others then
      if sqlerrm <> 'invalid_settings' then raise; end if;
    end;
  end loop;
  begin
    update public.site_config set settings = settings - 'freeShippingOver' where id = 1;
    raise exception 'TEST FAILED: threshold removed';
  exception when others then
    if sqlerrm <> 'invalid_settings' then raise; end if;
  end;
end $$;
reset role;
do $$ begin
  if (select settings -> 'freeShippingOver' from public.site_config) <> '600'::jsonb then raise exception 'TEST FAILED: threshold changed'; end if;
end $$;
select 'ok 17 - the free-shipping threshold stays a number, 0 or more' as result;

-- 18. "I have paid" reaches the team (once); an unknown event cannot be queued --
do $$
declare v_id uuid; v_number text;
begin
  select id, number into v_id, v_number from public.commit_order(pg_temp.test_order('so-brazil', 250, 1, 'bank_transfer', 'Virement'), '', '', '');
  set local role anon;
  perform public.report_offline_payment(v_id, 'VIR-2026-55');
  perform public.report_offline_payment(v_id, 'AUTRE'); -- already waiting for checking: nothing new
  reset role;
  if (select count(*) from public.notification_outbox where event = 'payment.reported') <> 2 then raise exception 'TEST FAILED: report not queued once per channel'; end if;
  if not exists (select 1 from public.notification_outbox where event = 'payment.reported'
                   and body like 'Paiement signalé ' || v_number || '%' and body like '%VIR-2026-55%' and body like '%12 rue Test%') then
    raise exception 'TEST FAILED: report message';
  end if;
  begin
    perform public.queue_notification('payment.paid', 'x', 'x', 'x');
    raise exception 'TEST FAILED: unknown event queued';
  exception when check_violation then null;
  end;
end $$;
select 'ok 18 - "I have paid" reaches the team once; unknown events cannot be queued' as result;

-- 19. Staff cannot change an origin's price per kg (it prices every blend) ------
set role authenticated;
set request.jwt.claims = '{"sub": "00000000-0000-0000-0000-000000000002", "aal": "aal2"}'; -- staff
update public.origins set price_per_kg = 1 where id = 'brazil';
do $$ begin
  begin
    insert into public.origins (id, name, country_code, species, roast_level, stock_kg, low_stock_kg, price_per_kg)
    values ('staff-origin', '{"fr": "X"}', 'BR', 'arabica', 'light', 0, 1, 1);
    raise exception 'TEST FAILED: staff created an origin';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
do $$ begin
  if (select price_per_kg from public.origins where id = 'brazil') <> 230 then raise exception 'TEST FAILED: staff changed a price per kg'; end if;
end $$;
select 'ok 19 - staff cannot change origin prices or add origins' as result;

-- 20. B2B requests keep the same text limits as orders; origins a real price
do $$
declare
  col text; c text; v text; num text;
  val text[];
begin
  -- each text column, one character over its limit
  foreach col in array array['company:81', 'contact_name:81', 'phone:25', 'email:121', 'notes:501'] loop
    c := split_part(col, ':', 1);
    v := repeat('x', split_part(col, ':', 2)::int);
    num := 'QR-2026-L' || upper(left(md5(col), 5));
    -- company, contact_name, phone, email, notes: valid values except the one under test
    val := array[case c when 'company' then v else '' end, case c when 'contact_name' then v else 'Sara' end,
                 case c when 'phone' then v else '1' end, case c when 'email' then v else '' end, case c when 'notes' then v else '' end];
    begin
      insert into public.quote_requests (number, business_type, company, contact_name, phone, email, notes, city_id, lines, weight_kg, indicative_total)
      values (num, 'cafe', val[1], val[2], val[3], val[4], val[5], 'oujda', '[]', 11, 100);
      raise exception 'TEST FAILED: quote_requests.% accepted % characters', c, length(v);
    exception when check_violation then null;
    end;
  end loop;
  insert into public.quote_requests (number, business_type, contact_name, phone, city_id, lines, weight_kg, indicative_total, notes)
  values ('QR-2026-OK0001', 'cafe', 'Sara', '+212661000000', 'oujda', '[]', 11, 100, repeat('x', 500));
  foreach v in array array['0', '0.5', '0.99'] loop
    begin
      update public.origins set price_per_kg = v::numeric where id = 'brazil';
      raise exception 'TEST FAILED: origin at % DH per kg', v;
    exception when check_violation then null;
    end;
  end loop;
  update public.origins set price_per_kg = 1 where id = 'brazil';  -- 1 DH is a real price
  update public.origins set price_per_kg = 230 where id = 'brazil';
end $$;
select 'ok 20 - B2B requests have the same length limits as orders; origins have a real price' as result;

-- 21. Stock and amounts are real numbers: 'NaN' is a valid numeric that sorts above
--     every number, so "stock_kg >= 0" alone accepted it (audit H1) ---------------
set role authenticated;
set request.jwt.claims = '{"sub": "00000000-0000-0000-0000-000000000002", "aal": "aal2"}'; -- staff
do $$
declare v text; before numeric := (select stock_kg from public.origins where id = 'vietnam');
begin
  foreach v in array array['NaN', 'Infinity', '-Infinity', null] loop
    begin
      perform public.adjust_stock('vietnam', v::numeric, 'correction', 'test');
      raise exception 'TEST FAILED: adjust_stock accepted %', v;
    exception when others then
      if sqlerrm <> 'invalid_delta' then raise; end if;
    end;
  end loop;
  if (select stock_kg from public.origins where id = 'vietnam') <> before then raise exception 'TEST FAILED: stock changed'; end if;
  -- a real change still works
  perform public.adjust_stock('vietnam', 1, 'correction', 'test');
  perform public.adjust_stock('vietnam', -1, 'correction', 'test');
  if (select stock_kg from public.origins where id = 'vietnam') <> before then raise exception 'TEST FAILED: real change'; end if;
end $$;
reset role;
do $$
declare col text;
begin
  -- no NaN in a numeric column, even written directly on the server
  perform set_config('boga.stock_write', 'on', true);
  foreach col in array array['stock_kg', 'low_stock_kg', 'price_per_kg'] loop
    begin
      execute format('update public.origins set %I = ''NaN'' where id = ''brazil''', col);
      raise exception 'TEST FAILED: origins.% accepted NaN', col;
    exception when check_violation then null;
    end;
  end loop;
  -- an order cannot deduct NaN or Infinity kg
  foreach col in array array['NaN', 'Infinity'] loop
    begin
      perform public.commit_order(
        format('{"locale": "fr", "customer": {"fullName": "Test", "phone": "+212612345678", "cityId": "oujda", "address": "Rue 1"},
          "lines": [], "weightKg": 1, "subtotal": 225, "shippingFee": 20, "total": 245, "paymentMethod": "cashplus",
          "stockDeductions": [{"originId": "brazil", "kg": "%s"}]}', col)::jsonb,
        'Nouvelle commande {number}', 'Nouvelle commande {number}', '[BOGA CAFÉ] Commande {number}');
      raise exception 'TEST FAILED: commit_order accepted % kg', col;
    exception when others then
      if sqlerrm <> 'invalid_order' then raise; end if;
    end;
  end loop;
end $$;
do $$
declare r record;
begin
  -- every numeric column of every table has a check that refuses NaN
  for r in
    select c.table_name, c.column_name
      from information_schema.columns c
      join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
     where c.table_schema = 'public' and c.data_type in ('numeric', 'double precision', 'real') and t.table_type = 'BASE TABLE'
  loop
    if not exists (
      select 1 from pg_constraint k
        join pg_class cl on cl.oid = k.conrelid
        join pg_namespace n on n.oid = cl.relnamespace
       where n.nspname = 'public' and cl.relname = r.table_name and k.contype = 'c'
         and pg_get_constraintdef(k.oid) ~ ('\m' || r.column_name || '\M')
         and pg_get_constraintdef(k.oid) like '%NaN%'
    ) then
      raise exception 'TEST FAILED: %.% has no NaN check', r.table_name, r.column_name;
    end if;
  end loop;
end $$;
select 'ok 21 - stock and amounts are real numbers (no NaN, no Infinity)' as result;

-- 22. The database checks every figure of an order itself (audit H2): a forged
--     price, size, quantity, customer, city, payment method or stock is refused ---
do $$
declare
  o      jsonb := pg_temp.test_order('so-brazil', 250, 2, 'bank_transfer');  -- 2 × 60 DH + 20
  c      record;
  n      integer := (select count(*) from public.orders);
  stock  numeric := (select stock_kg from public.origins where id = 'brazil');
begin
  for c in select * from (values
    ('total',            o || '{"total": 0.01}'),
    ('subtotal',         o || '{"subtotal": 1, "total": 21}'),
    ('size',             jsonb_set(o, '{lines,0,size}', '7')),
    ('size_not_offered', jsonb_set(pg_temp.test_order('signature', 1000, 1, 'card'), '{lines,0,size}', '250')),
    ('qty',              jsonb_set(o, '{lines,0,qty}', '-5')),
    ('qty',              jsonb_set(o, '{lines,0,qty}', '0')),
    ('qty',              jsonb_set(o, '{lines,0,qty}', '101')),
    ('qty',              jsonb_set(o, '{lines,0,qty}', '1.5')),
    ('price',            jsonb_set(jsonb_set(o, '{lines,0,unitPrice}', '1'), '{lines,0,lineTotal}', '2') || '{"subtotal": 2, "total": 22}'),
    ('price',            jsonb_set(jsonb_set(o, '{lines,0,unitPrice}', '61'), '{lines,0,lineTotal}', '122') || '{"subtotal": 122, "total": 142}'),
    ('price',            jsonb_set(jsonb_set(o, '{lines,0,unitPrice}', '60.5'), '{lines,0,lineTotal}', '121') || '{"subtotal": 121, "total": 141}'),
    ('line_total',       jsonb_set(o, '{lines,0,lineTotal}', '1')),
    ('composition',      jsonb_set(pg_temp.test_order('signature', 1000, 1, 'card'), '{lines,0,composition}', '[{"originId": "brazil", "percent": 90}, {"originId": "vietnam", "percent": 20}]')),
    ('composition',      jsonb_set(pg_temp.test_order('signature', 1000, 1, 'card'), '{lines,0,composition}', '[{"originId": "brazil", "percent": 100, "grams": 1000}]')),
    ('product',          jsonb_set(o, '{lines,0,productId}', '"ghost"')),
    ('product',          pg_temp.test_order('retired', 250, 1, 'card')),          -- no longer sold
    ('kind',             jsonb_set(o, '{lines,0,kind}', '"gift"')),
    ('lines',            o || '{"lines": []}'),
    ('weight',           o || '{"weightKg": 0.1}'),
    ('b2b',              pg_temp.test_order('so-brazil', 1000, 11, 'bank_transfer')),  -- 11 kg
    ('b2b',              pg_temp.test_order('so-brazil', 250, 100, 'bank_transfer')),  -- 100 bags is a valid quantity, 25 kg is not a cart
    ('bulk_only',        pg_temp.test_order('horeca', 1000, 1, 'bank_transfer')),     -- a B2B blend's 1 kg bag is quote-only
    ('phone',            jsonb_set(o, '{customer,phone}', '"DROP TABLE"')),
    ('name',             jsonb_set(o, '{customer,fullName}', '"X"')),
    ('name',             jsonb_set(o, '{customer,fullName}', '"Al"')),
    ('name',             jsonb_set(o, '{customer,fullName}', '"\u00a0Al\u3000"')),       -- JavaScript trim() removes both
    ('name',             jsonb_set(o, '{customer,fullName}', '"\ud83d\ude00\ud83d\ude00"')),  -- two characters, not four
    ('name',             jsonb_set(o, '{customer,fullName}', to_jsonb(repeat('x', 81)))),
    ('address',          jsonb_set(o, '{customer,address}', '"a"')),
    ('address',          jsonb_set(o, '{customer,address}', '"12 ru"')),
    ('address',          jsonb_set(o, '{customer,address}', '"\u200312 ru\u00a0"')),
    ('address',          jsonb_set(o, '{customer,address}', to_jsonb(repeat('x', 201)))),
    ('email',            jsonb_set(o, '{customer,email}', to_jsonb(repeat('x', 113) || '@boga.ma'))),  -- 121 characters, 120 is the limit
    ('email',            jsonb_set(o, '{customer,email}', '"pas-un-email"')),
    ('email',            jsonb_set(o, '{customer,email}', '"a\u00a0b@boga.ma"')),
    ('text_too_long',    jsonb_set(o, '{customer,company}', to_jsonb(repeat('x', 81)))),
    ('text_too_long',    jsonb_set(o, '{customer,notes}', to_jsonb(repeat('x', 501)))),
    ('locale',           o || '{"locale": "de"}'),
    ('city',             jsonb_set(o, '{customer,cityId}', '"nador"')),        -- inactive
    ('city',             jsonb_set(o, '{customer,cityId}', '"paris"')),
    ('shipping',         o || '{"shippingFee": 0, "total": 120}'),
    ('payment_method',   o || '{"paymentMethod": "cashplus"}'),                 -- disabled
    ('payment_method',   o || '{"paymentMethod": "paypal"}'),
    ('deductions',       o || '{"stockDeductions": [{"originId": "brazil", "kg": 0.1}]}'),
    ('deductions',       o || '{"stockDeductions": [{"originId": "brazil", "kg": 0.501}]}'),
    ('deductions',       o || '{"stockDeductions": [{"originId": "brazil", "kg": 0.5009}]}'),
    ('deductions',       o || '{"stockDeductions": [{"originId": "brazil", "kg": 0.5}, {"originId": "vietnam", "kg": 0.1}]}'),
    ('blend_paused',     jsonb_set(jsonb_set(o, '{lines,0,kind}', '"custom"'), '{lines,0,composition}', '[{"originId": "brazil", "percent": 100}]'))
  ) as t(reason, bad) loop
    begin
      perform public.commit_order(c.bad, '', '', '');
      raise exception 'TEST FAILED: forged order accepted (%)', c.reason;
    exception when others then
      if sqlerrm <> 'invalid_order:' || c.reason then
        raise exception 'TEST FAILED: expected invalid_order:%, got %', c.reason, sqlerrm;
      end if;
    end;
  end loop;
  if (select count(*) from public.orders) <> n then raise exception 'TEST FAILED: a forged order was saved'; end if;
  if (select stock_kg from public.origins where id = 'brazil') <> stock then raise exception 'TEST FAILED: stock moved'; end if;
  -- the real order goes through, at the limits (3-letter name, 6-letter address, white
  -- space of any kind around them); what is saved is rebuilt by the database: name and
  -- grams of the line from the catalog, trimmed customer, normalized phone
  o := jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(o,
         '{customer,fullName}', '"\u00a0Ali\u3000"'), '{customer,address}', '"\u200312 rue"'),
         '{customer,phone}', '"06\u00a012 34.56-78"'), '{lines,0,name}', '{"fr": "Offert"}'),
         '{lines,0,composition,0,grams}', '1'), '{lines,0,promo}', '"-100 %"');
  -- and at the upper limits: 80, 200 and 120 characters
  perform public.commit_order(jsonb_set(jsonb_set(jsonb_set(o, '{customer,fullName}', to_jsonb(repeat('x', 80))),
    '{customer,address}', to_jsonb(repeat('x', 200))), '{customer,email}', to_jsonb(repeat('x', 112) || '@boga.ma')), '', '', '');
  stock := stock - 0.5;
  perform public.commit_order(o, '', '', '');
  if (select stock_kg from public.origins where id = 'brazil') <> stock - 0.5 then raise exception 'TEST FAILED: real order'; end if;
  if (select (customer_name, address, phone, lines, stock_deductions) from public.orders order by created_at desc, number desc limit 1)
     is distinct from ('Ali'::text, '12 rue'::text, '+212612345678'::text,
       '[{"kind": "product", "productId": "so-brazil", "name": {"fr": "Brésil"}, "size": 250, "qty": 2, "unitPrice": 60, "lineTotal": 120,
          "composition": [{"originId": "brazil", "percent": 100, "grams": 250}]}]'::jsonb,
       '[{"kg": 0.500, "originId": "brazil"}]'::jsonb) then
    raise exception 'TEST FAILED: saved order is not the one rebuilt by the database';
  end if;
  -- the table refuses rows that break its own rules, whoever writes them
  for c in select * from (values
    ('total',  $q$(99, 60, 20, 0.25, 'Ali')$q$),
    ('weight', $q$(80, 60, 20, 0, 'Ali')$q$),
    ('free',   $q$(-40, -60, 20, 0.25, 'Ali')$q$),
    ('name',   $q$(80, 60, 20, 0.25, '')$q$)
  ) as t(reason, bad) loop
    begin
      execute 'insert into public.orders (number, total, subtotal, shipping_fee, weight_kg, customer_name, phone, city_id, address, lines, payment_method, stock_deductions)
               select ''T-' || c.reason || ''', v.*, ''+212612345678'', ''oujda'', ''12 rue'', ''[]'', ''card'', ''[]'' from (values ' || c.bad || ') v';
      raise exception 'TEST FAILED: order row accepted (%)', c.reason;
    exception when check_violation then null;
    end;
  end loop;
end $$;

-- Custom Blend: price recomputed from the origins, and the blend rules
set request.jwt.claims = '{"sub": "00000000-0000-0000-0000-000000000001", "aal": "aal2"}'; -- owner changes the settings
-- free delivery from the threshold itself (src/core/shipping.ts: subtotal >= freeShippingOver)
update public.site_config set settings = settings || '{"freeShippingOver": 120}';
do $$
declare o jsonb := pg_temp.test_order('so-brazil', 250, 2, 'bank_transfer');  -- subtotal 120
begin
  begin
    perform public.commit_order(o, '', '', '');  -- still charges 20 DH of delivery
    raise exception 'TEST FAILED: delivery charged at the free-delivery threshold';
  exception when others then
    if sqlerrm <> 'invalid_order:shipping' then raise; end if;
  end;
  perform public.commit_order(o || '{"shippingFee": 0, "total": 120}', '', '', '');
end $$;
update public.site_config set settings = settings || '{"freeShippingOver": 0}';
update public.site_config set settings = settings || '{"customBlend": {"enabled": true, "minPercent": 5, "maxOrigins": 4, "feeBySize": {"250": 10, "500": 15, "1000": 20}}}';
select set_config('boga.stock_write', 'on', false);  -- test setup: enough Viet Nam for the blend
update public.origins set stock_kg = 5 where id = 'vietnam';
select set_config('boga.stock_write', '', false);
do $$
declare
  -- 250 g, 60 % Brazil (230 DH/kg since check 20) + 40 % Viet Nam (150 DH/kg) + 10 DH bag
  -- = 34.5 + 15 + 10 = 59.5, rounded to 60 DH (src/core/money.ts roundMoney)
  line   jsonb := '{"kind": "custom", "name": {"fr": "Mon Custom Blend"}, "size": 250, "qty": 1, "unitPrice": 60, "lineTotal": 60,
                    "composition": [{"originId": "brazil", "percent": 60, "grams": 150}, {"originId": "vietnam", "percent": 40, "grams": 100}]}';
  o      jsonb;
  c      record;
begin
  o := pg_temp.test_order('so-brazil', 250, 1, 'card') || jsonb_build_object(
         'lines', jsonb_build_array(line), 'weightKg', 0.25, 'subtotal', 60, 'shippingFee', 20, 'total', 80,
         'stockDeductions', '[{"originId": "brazil", "kg": 0.15}, {"originId": "vietnam", "kg": 0.1}]'::jsonb);
  for c in select * from (values
    ('price',        jsonb_set(jsonb_set(o, '{lines,0,unitPrice}', '50'), '{lines,0,lineTotal}', '50') || '{"subtotal": 50, "total": 70}'),
    ('price',        jsonb_set(jsonb_set(o, '{lines,0,unitPrice}', '61'), '{lines,0,lineTotal}', '61') || '{"subtotal": 61, "total": 81}'),
    ('price',        jsonb_set(jsonb_set(o, '{lines,0,unitPrice}', '60.5'), '{lines,0,lineTotal}', '61') || '{"subtotal": 61, "total": 81}'),
    ('blend',        jsonb_set(o, '{lines,0,composition}', '[{"originId": "brazil", "percent": 97}, {"originId": "vietnam", "percent": 3}]')),
    ('blend',        jsonb_set(o, '{lines,0,composition}', '[{"originId": "brazil", "percent": 96}, {"originId": "vietnam", "percent": 4}]')),
    ('blend',        jsonb_set(o, '{lines,0,composition}', '[{"originId": "brazil", "percent": 60}, {"originId": "vietnam", "percent": 30}]')),
    ('blend',        jsonb_set(o, '{lines,0,composition}', '[{"originId": "brazil", "percent": 50}, {"originId": "brazil", "percent": 50}]')),
    ('blend_origin', jsonb_set(o, '{lines,0,composition}', '[{"originId": "brazil", "percent": 60}, {"originId": "ghost", "percent": 40}]'))
  ) as t(reason, bad) loop
    begin
      perform public.commit_order(c.bad, '', '', '');
      raise exception 'TEST FAILED: forged blend accepted (%)', c.reason;
    exception when others then
      if sqlerrm <> 'invalid_order:' || c.reason then
        raise exception 'TEST FAILED: expected invalid_order:%, got %', c.reason, sqlerrm;
      end if;
    end;
  end loop;
  update public.origins set custom_blend_enabled = false where id = 'vietnam';
  begin
    perform public.commit_order(o, '', '', '');
    raise exception 'TEST FAILED: origin out of the builder accepted';
  exception when others then
    if sqlerrm <> 'invalid_order:blend_origin' then raise; end if;
  end;
  update public.origins set custom_blend_enabled = true where id = 'vietnam';
  update public.site_config set settings = jsonb_set(settings, '{customBlend,maxOrigins}', '1');
  begin
    perform public.commit_order(o, '', '', '');
    raise exception 'TEST FAILED: more origins than allowed accepted';
  exception when others then
    if sqlerrm <> 'invalid_order:blend' then raise; end if;
  end;
  update public.site_config set settings = jsonb_set(settings, '{customBlend,maxOrigins}', '2');
  perform public.commit_order(o, '', '', '');   -- the real blend goes through, 2 origins of 2 allowed
  -- 95 % + the minimum 5 %: 54.625 + 1.875 + 10 = 66.5 DH, rounded up to 67 DH; stock
  -- 0.2375 kg and 0.0125 kg, rounded up to 0.238 and 0.013 (src/core/money.ts)
  perform public.commit_order(o || jsonb_build_object(
    'lines', jsonb_build_array(line || '{"unitPrice": 67, "lineTotal": 67, "composition": [{"originId": "brazil", "percent": 95}, {"originId": "vietnam", "percent": 5}]}'),
    'subtotal', 67, 'total', 87, 'stockDeductions', '[{"originId": "brazil", "kg": 0.238}, {"originId": "vietnam", "kg": 0.013}]'::jsonb), '', '', '');
  if (select lines -> 0 -> 'name' = '{"ar": "خلطتي الخاصة", "fr": "Mon Custom Blend", "en": "My Custom Blend"}'
             and lines #> '{0,composition}' = '[{"originId": "brazil", "percent": 95, "grams": 237.5}, {"originId": "vietnam", "percent": 5, "grams": 12.5}]'
        from public.orders order by created_at desc, number desc limit 1) is not true then
    raise exception 'TEST FAILED: saved blend line';
  end if;
  -- the same B2B blend in 250 g and 500 g is a paid sample: an ordinary order
  perform public.commit_order(pg_temp.test_order('horeca', 250, 1, 'bank_transfer'), '', '', '');
  perform public.commit_order(pg_temp.test_order('horeca', 500, 2, 'bank_transfer'), '', '', '');
end $$;
select 'ok 22 - every figure of an order is checked by the database (price, size, quantity, customer, city, payment, stock, blend rules, B2B 1 kg bag)' as result;

-- 23. Every reservation ends, and money stays the owner's decision (audit H3, M5) --
--     Unpaid (48 h) and payment reported but not confirmed (120 h), even once
--     confirmed; paid orders never expire; nobody but the owner cancels a paid
--     or reported order; a claim never becomes "paid" by itself.
create temp table t23 (k text primary key, id uuid);
grant all on t23 to anon, authenticated;
insert into t23 select k, (select id from public.commit_order(pg_temp.test_order('so-brazil', 250, 1, 'bank_transfer', 'Client ' || k), '', '', ''))
  from unnest(array['unpaid', 'reported', 'confirmed', 'paid', 'refused']) k;
set role anon;  -- the customer, from the order page
do $$ begin
  perform public.report_offline_payment((select id from t23 where k = 'reported'), 'REF-1');
  perform public.report_offline_payment((select id from t23 where k = 'refused'), 'REF-2');
end $$;
reset role;
set role authenticated;
do $$
declare r text;
begin
  perform set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-000000000002", "aal": "aal2"}', true); -- staff
  perform public.set_order_status((select id from t23 where k = 'confirmed'), 'confirmed');
  -- staff cannot record money, nor cancel an order the customer says is paid
  begin perform public.set_payment_status((select id from t23 where k = 'reported'), 'paid'); r := 'accepted';
  exception when others then r := sqlerrm; end;
  if r <> 'forbidden' then raise exception 'TEST FAILED: staff recorded a payment (%)', r; end if;
  begin perform public.set_order_status((select id from t23 where k = 'reported'), 'cancelled'); r := 'accepted';
  exception when others then r := sqlerrm; end;
  if r <> 'owner_only' then raise exception 'TEST FAILED: staff cancelled a reported payment (%)', r; end if;
  perform set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-000000000001", "aal": "aal2"}', true); -- owner
  perform public.set_payment_status((select id from t23 where k = 'paid'), 'paid');
  perform public.set_payment_status((select id from t23 where k = 'refused'), 'failed');  -- found nothing on the account
  -- even the owner ends a paid order with a refund, not a plain cancel
  begin perform public.set_order_status((select id from t23 where k = 'paid'), 'cancelled'); r := 'accepted';
  exception when others then r := sqlerrm; end;
  if r <> 'refund_instead' then raise exception 'TEST FAILED: paid order cancelled without refund (%)', r; end if;
  -- the deadlines are limits, never "off"
  foreach r in array array['0', '-1', '"48"', 'null'] loop
    begin
      update public.site_config set settings = jsonb_set(settings, '{unpaidOrderTimeoutHours}', r::jsonb);
      raise exception 'TEST FAILED: deadline % accepted', r;
    exception when others then if sqlerrm <> 'invalid_settings' then raise; end if;
    end;
  end loop;
  begin
    update public.site_config set settings = jsonb_set(settings, '{paymentCheckTimeoutHours}', '0');
    raise exception 'TEST FAILED: check deadline 0 accepted';
  exception when others then if sqlerrm <> 'invalid_settings' then raise; end if;
  end;
end $$;
reset role;
set role anon;
do $$ begin
  -- a paid order cannot be turned back into a claim; a refused claim can be sent again
  perform public.report_offline_payment((select id from t23 where k = 'paid'), 'FAKE');
  perform public.report_offline_payment((select id from t23 where k = 'refused'), 'REF-2b');
end $$;
reset role;
do $$
declare
  st numeric := (select stock_kg from public.origins where id = 'brazil');
  ids uuid[] := array(select id from t23 order by k);
  got text;
begin
  select string_agg(k || '=' || o.payment_status, ',' order by k) into got from t23 join public.orders o using (id);
  if got <> 'confirmed=pending,paid=paid,refused=awaiting_verification,reported=awaiting_verification,unpaid=pending' then
    raise exception 'TEST FAILED: payment states %', got;
  end if;
  update public.orders set created_at = now() - interval '47 hours' where id = any(ids);
  if public.expire_unpaid_orders() <> 0 then raise exception 'TEST FAILED: expired before 48 h'; end if;
  update public.orders set created_at = now() - interval '49 hours' where id = any(ids);
  if public.expire_unpaid_orders() <> 2 then raise exception 'TEST FAILED: unpaid and confirmed-unpaid not expired at 49 h'; end if;
  if (select stock_kg from public.origins where id = 'brazil') <> st + 0.5 then raise exception 'TEST FAILED: stock at 49 h'; end if;
  update public.orders set created_at = now() - interval '121 hours' where id = any(ids);
  if public.expire_unpaid_orders() <> 2 then raise exception 'TEST FAILED: reported claims not expired at 121 h'; end if;
  update public.orders set created_at = now() - interval '5000 hours' where id = any(ids);
  if public.expire_unpaid_orders() <> 0 then raise exception 'TEST FAILED: expired twice, or a paid order'; end if;
  if (select stock_kg from public.origins where id = 'brazil') <> st + 1 then raise exception 'TEST FAILED: stock returned % times', (select stock_kg from public.origins where id = 'brazil') - st; end if;
  select string_agg(k || '=' || o.status, ',' order by k) into got from t23 join public.orders o using (id);
  if got <> 'confirmed=cancelled,paid=confirmed,refused=cancelled,reported=cancelled,unpaid=cancelled' then
    raise exception 'TEST FAILED: statuses %', got;
  end if;
  -- a missing or broken setting (a row written before the guard existed) falls back
  -- to 48 h instead of turning expiry off
  alter table public.site_config disable trigger site_config_guard_settings;
  update public.site_config set settings = settings || '{"unpaidOrderTimeoutHours": 0}';
  alter table public.site_config enable trigger site_config_guard_settings;
  insert into t23 select 'late', (select id from public.commit_order(pg_temp.test_order('so-brazil', 250, 1, 'bank_transfer'), '', '', ''));
  update public.orders set created_at = now() - interval '49 hours' where id = (select id from t23 where k = 'late');
  if public.expire_unpaid_orders() <> 1 then raise exception 'TEST FAILED: no setting = no expiry'; end if;
  alter table public.site_config disable trigger site_config_guard_settings;
  update public.site_config set settings = settings || '{"unpaidOrderTimeoutHours": 48}';
  alter table public.site_config enable trigger site_config_guard_settings;
  -- no payment details, no order to pay into nowhere
  update public.site_config set settings = jsonb_set(settings, '{bank,rib}', '"  "');
  begin
    perform public.commit_order(pg_temp.test_order('so-brazil', 250, 1, 'bank_transfer'), '', '', '');
    raise exception 'TEST FAILED: transfer order without a RIB';
  exception when others then if sqlerrm <> 'invalid_order:payment_details' then raise; end if;
  end;
  update public.site_config set settings = jsonb_set(settings, '{bank,rib}', '"OWNER-RIB"');
end $$;
select 'ok 23 - every reservation ends (48 h unpaid, 120 h reported); only the owner cancels paid or reported orders; no transfer without a RIB' as result;

-- 24. Who can read and change what (audit M1): each sensitive table and function,
--     for a visitor (anon), a signed-in customer who is not on the team, staff and a
--     manager. 'none' = refused or nothing seen/changed; 'some' = the role's own work.
insert into auth.users values ('00000000-0000-0000-0000-000000000009');  -- a customer account
-- a B2B request, so "sees none" means hidden, not empty
insert into public.quote_requests (number, business_type, contact_name, phone, city_id, lines, weight_kg, indicative_total)
values ('QR-T24', 'hotel', 'Client', '0600000000', 'oujda', '[]', 20, 4000);
create temp table t24 (n serial, who text, q text, expect text, sane boolean default true);
grant all on t24 to anon, authenticated;
grant all on sequence t24_n_seq to anon, authenticated;
insert into t24 (who, q, expect)
select who, q, 'none' from unnest(array['anon', 'customer']) who, unnest(array[
  'select count(*) from public.orders',
  'select count(*) from public.order_events',
  'select count(*) from public.stock_movements',
  'select count(*) from public.notification_outbox',
  'select count(*) from public.quote_requests',
  'select count(*) from public.admin_config',
  'select count(*) from public.admin_users',
  $q$insert into public.admin_users values ('00000000-0000-0000-0000-000000000009', 'owner', 'Me') returning 1$q$,
  $q$insert into public.quote_requests (number, business_type, contact_name, phone, city_id, lines, weight_kg, indicative_total) values ('X', 'cafe', 'X', '0600000000', 'oujda', '[]', 20, 1) returning 1$q$,
  $q$with u as (update public.site_config set content = '{}' returning 1) select count(*) from u$q$,
  $q$with u as (update public.shipping_rates set base_fee = 0 returning 1) select count(*) from u$q$,
  $q$with u as (update public.payment_methods set enabled = true returning 1) select count(*) from u$q$,
  $q$select public.adjust_stock('brazil', 100, 'restock')::int$q$,
  $q$select 1 from public.set_order_status((select id from t23 where k = 'paid'), 'in_production')$q$,
  $q$select 1 from public.set_payment_status((select id from t23 where k = 'unpaid'), 'refunded')$q$,
  $q$select count(*) from public.commit_order(pg_temp.test_order('so-brazil', 250, 1, 'bank_transfer'), '', '', '')$q$
]) q;
insert into t24 (who, q, expect, sane) values
  -- staff: the orders, yes; the owner's configuration, the team, delivery prices and money, no
  ('staff',   'select count(*) from public.orders', 'some', true),
  ('staff',   'select count(*) from public.notification_outbox', 'none', true),
  ('staff',   'select count(*) from public.admin_config', 'none', true),
  ('staff',   $q$with u as (update public.admin_users set role = 'owner' where user_id = auth.uid() returning 1) select count(*) from u$q$, 'none', true),
  ('staff',   $q$insert into public.admin_users values ('00000000-0000-0000-0000-000000000009', 'owner', 'Friend') returning 1$q$, 'none', true),
  ('staff',   $q$with u as (update public.site_config set content = '{}' returning 1) select count(*) from u$q$, 'none', true),
  ('staff',   $q$with u as (update public.shipping_rates set base_fee = 0 returning 1) select count(*) from u$q$, 'none', true),
  ('staff',   $q$insert into public.shipping_rates (id, city, base_fee) values ('x', '{}', 0) returning 1$q$, 'none', true),
  ('staff',   $q$select 1 from public.set_payment_status((select id from t23 where k = 'unpaid'), 'refunded')$q$, 'none', true),
  -- manager: the outbox, yes; who receives it, the team and the payment methods, no
  ('manager', 'select count(*) from public.notification_outbox', 'some', true),
  ('manager', 'select count(*) from public.admin_config', 'none', true),
  ('manager', $q$with u as (update public.admin_users set role = 'owner' where user_id = auth.uid() returning 1) select count(*) from u$q$, 'none', true),
  ('manager', $q$with u as (update public.payment_methods set enabled = true returning 1) select count(*) from u$q$, 'none', true),
  -- the customer's order page shows the order, never the phone or the address
  ('anon', format($q$select count(*) from public.get_order_public(%L) g where row(g.*)::text like %L or row(g.*)::text like %L$q$,
                  (select id from public.orders where phone <> '' order by created_at limit 1),
                  '%' || (select right(phone, 8) from public.orders where phone <> '' order by created_at limit 1) || '%',
                  '%' || (select address from public.orders where phone <> '' order by created_at limit 1) || '%'), 'none', false),
  ('anon', format('select count(*) from public.get_order_public(%L)', (select id from public.orders order by created_at limit 1)), 'some', false);
do $$
declare c record; got bigint; outcome text;
begin
  -- each refused case must be a query that works for the owner: a typo or a missing
  -- row would otherwise pass as "refused"
  for c in select * from t24 where sane order by n loop
    perform set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-000000000001", "aal": "aal2"}', true);
    begin
      execute c.q into got;
      outcome := case when coalesce(got, 0) > 0 then 'some' else 'none' end;
      raise exception 'undo';
    exception when others then
      if sqlerrm <> 'undo' then outcome := 'error: ' || sqlerrm; end if;
    end;
    if outcome <> 'some' then raise exception 'TEST BROKEN: "%" does nothing even for the owner (%)', c.q, outcome; end if;
  end loop;
  for c in select * from t24 order by n loop
    perform set_config('request.jwt.claims', case c.who when 'staff' then '{"sub": "00000000-0000-0000-0000-000000000002", "aal": "aal2"}'
      when 'manager' then '{"sub": "00000000-0000-0000-0000-000000000003", "aal": "aal2"}'
      when 'customer' then '{"sub": "00000000-0000-0000-0000-000000000009", "aal": "aal2"}' else '' end, true);
    execute case when c.who = 'anon' then 'set local role anon' else 'set local role authenticated' end;
    begin
      execute c.q into got;
      outcome := case when coalesce(got, 0) > 0 then 'some' else 'none' end;
      raise exception 'undo';  -- whatever it did is rolled back
    exception when others then
      if sqlerrm <> 'undo' then outcome := 'none'; end if;
    end;
    execute 'reset role';
    if outcome <> c.expect then
      raise exception 'TEST FAILED: % could do "%" (%, expected %)', c.who, c.q, outcome, c.expect;
    end if;
  end loop;
end $$;
-- a switched-off channel gets nothing (Admin → Notifications)
do $$
declare wa bigint := (select count(*) from public.notification_outbox where channel = 'whatsapp');
begin
  update public.admin_config set whatsapp_on = false;
  perform public.queue_notification('order.created', 's', 'w', 'e');
  update public.admin_config set whatsapp_on = true;
  if (select count(*) from public.notification_outbox where channel = 'whatsapp') <> wa then raise exception 'TEST FAILED: WhatsApp switched off still queued'; end if;
end $$;
select 'ok 24 - anon, customers, staff and managers only reach what their role allows (' || (select count(*) from t24) || ' cases)' as result;

-- 25. The table rules hold whoever writes: a recipe line is 1 to 100 %, and a
--     switched-off origin is never sold, even inside an active product -----------
do $$
declare p int;
begin
  foreach p in array array[0, 101] loop
    begin
      insert into public.product_recipes values ('retired', 'vietnam', p);
      raise exception 'TEST FAILED: recipe line of % %% accepted', p;
    exception when check_violation then null;
    end;
  end loop;
  perform set_config('boga.stock_write', 'on', true);
  update public.origins set active = false where id = 'brazil';
  begin
    perform public.commit_order(pg_temp.test_order('so-brazil', 250, 1, 'bank_transfer'), '', '', '');
    raise exception 'TEST FAILED: switched-off origin sold';
  exception when others then if sqlerrm <> 'out_of_stock:brazil' then raise; end if;
  end;
  update public.origins set active = true where id = 'brazil';
  -- even a write that goes past the functions (stock gate open) cannot store negative stock
  begin
    update public.origins set stock_kg = -0.001 where id = 'vietnam';
    raise exception 'TEST FAILED: negative stock stored';
  exception when check_violation then null;
  end;
end $$;
select 'ok 25 - recipe lines 1 to 100 %; a switched-off origin is never sold; stock never below 0' as result;

-- 26. Live server step: internal helpers closed to the API; B2B requests and rate
--     limits are server-only; the low-stock trigger still fires --------------------
-- a bucket exists, so "anon reads no rate limits" means row level security hides it
insert into public.rate_limits (bucket) values ('t26:existing');
set role anon;
do $$ begin
  begin
    perform public.admin_role();
    raise exception 'TEST FAILED: anon called admin_role';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.commit_quote_request('{}', '', '', '');
    raise exception 'TEST FAILED: anon saved a B2B request';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.rate_limit_hit('x', 1, 60);
    raise exception 'TEST FAILED: anon used the rate limiter';
  exception when insufficient_privilege then null;
  end;
  if (select count(*) from public.rate_limits) <> 0 then raise exception 'TEST FAILED: anon reads rate limits'; end if;
end $$;
reset role;
set role authenticated;
set request.jwt.claims = '{"sub": "00000000-0000-0000-0000-000000000001", "aal": "aal2"}'; -- owner
do $$ begin
  begin
    perform public.admin_role();
    raise exception 'TEST FAILED: owner called admin_role through the API';
  exception when insufficient_privilege then null;
  end;
  if not public.is_admin(array['owner']) then raise exception 'TEST FAILED: owner not recognised'; end if;
  -- a low-stock alert still comes from the trigger when stock moves through a function
  perform public.adjust_stock('brazil', -1000, 'correction', 'test 26');
end $$;
reset role;
set role service_role;
do $$
declare q record; n bigint;
begin
  select count(*) into n from public.notification_outbox where event = 'quote.created';
  select * into q from public.commit_quote_request(
    '{"businessType": "hotel", "contactName": "Sara", "phone": "+212612345679", "cityId": "oujda",
      "lines": [{"kind": "product", "productId": "horeca", "size": 1000, "qty": 12}], "weightKg": 12, "indicativeTotal": 1800}',
    'B2B {number}', 'B2B {number}', '[BOGA CAFÉ] B2B {number}');
  if q.number !~ '^QR-\d{4}-\d{4,}$' then raise exception 'TEST FAILED: quote number %', q.number; end if;
  if (select count(*) from public.notification_outbox where event = 'quote.created') <> n + 2 then raise exception 'TEST FAILED: quote notifications'; end if;
  if not exists (select 1 from public.notification_outbox where subject = '[BOGA CAFÉ] B2B ' || q.number) then raise exception 'TEST FAILED: number in subject'; end if;
  begin
    perform public.commit_quote_request('{"businessType": "hotel", "contactName": "Sara", "phone": "+212612345679", "cityId": "oujda", "lines": [], "weightKg": 0, "indicativeTotal": 0}', '', '', '');
    raise exception 'TEST FAILED: empty B2B request saved';
  exception when others then if sqlerrm <> 'invalid_quote:lines' then raise; end if;
  end;
  if not public.rate_limit_hit('t26:phone', 2, 3600) then raise exception 'TEST FAILED: first hit refused'; end if;
  if not public.rate_limit_hit('t26:phone', 2, 3600) then raise exception 'TEST FAILED: second hit refused'; end if;
  if public.rate_limit_hit('t26:phone', 2, 3600) then raise exception 'TEST FAILED: third hit allowed'; end if;
  if not public.rate_limit_hit('t26:other', 2, 3600) then raise exception 'TEST FAILED: buckets are not separate'; end if;
end $$;
reset role;
update public.rate_limits set window_start = now() - interval '61 minutes' where bucket = 't26:phone';
set role service_role;
do $$ begin
  if not public.rate_limit_hit('t26:phone', 2, 3600) then raise exception 'TEST FAILED: window did not restart'; end if;
  if not public.rate_limit_hit('t26:phone', 2, 3600) then raise exception 'TEST FAILED: second hit of the new window refused'; end if;
  if public.rate_limit_hit('t26:phone', 2, 3600) then raise exception 'TEST FAILED: third hit of the new window allowed'; end if;
end $$;
reset role;
do $$ begin
  if not exists (select 1 from public.notification_outbox where event = 'stock.low' and body like 'Stock bas : Brésil - 0%') then
    raise exception 'TEST FAILED: low-stock trigger after revoking its EXECUTE';
  end if;
end $$;
select 'ok 26 - internal helpers closed to the API; B2B requests and rate limits server-only; low-stock trigger still fires' as result;

-- 27. Slice 3b: the same order sent again with its key gives back the first order
--     (no second row, stock deduction or message); without a key, as before ---------
set role authenticated;
set request.jwt.claims = '{"sub": "00000000-0000-0000-0000-000000000001", "aal": "aal2"}'; -- owner
select public.adjust_stock('brazil', 5, 'restock', 'test 27');
reset role;
do $$
declare
  k uuid := 'b0ca0000-0000-4000-8000-000000000027';
  a record; b record; c record; x record; y record;
  n_orders bigint := (select count(*) from public.orders);
  n_moves bigint;
  n_out bigint;
  v_stock numeric;
begin
  select * into a from public.commit_order(pg_temp.test_order('so-brazil', 250, 1, 'bank_transfer', 'Client Cle'), 'N {number}', 'N {number}', 'S {number}', k);
  if not a.created or a.number !~ '^BC-' then raise exception 'TEST FAILED: first order with a key not saved'; end if;
  if (select idempotency_key from public.orders where id = a.id) is distinct from k then raise exception 'TEST FAILED: key not stored'; end if;
  select count(*) into n_moves from public.stock_movements;
  select count(*) into n_out from public.notification_outbox;
  select stock_kg into v_stock from public.origins where id = 'brazil';
  -- sent again, even when that cart would now be refused (here a closed method; also
  -- the last kilos gone or a new price): the first order comes back, nothing else happens
  select * into b from public.commit_order(pg_temp.test_order('so-brazil', 500, 2, 'cashplus', 'Client Cle'), 'N {number}', 'N {number}', 'S {number}', k);
  if b.created or b.id <> a.id or b.number <> a.number then raise exception 'TEST FAILED: same key gave %', b; end if;
  if (select count(*) from public.orders) <> n_orders + 1 then raise exception 'TEST FAILED: second row for one key'; end if;
  if (select count(*) from public.stock_movements) <> n_moves or (select count(*) from public.notification_outbox) <> n_out
     or (select stock_kg from public.origins where id = 'brazil') <> v_stock then
    raise exception 'TEST FAILED: a repeated key moved stock or queued a message';
  end if;
  -- another key is another order
  select * into c from public.commit_order(pg_temp.test_order('so-brazil', 250, 1, 'bank_transfer', 'Client Cle'), '', '', '', 'b0ca0000-0000-4000-8000-000000000028');
  if not c.created or c.id = a.id then raise exception 'TEST FAILED: a new key did not save a new order'; end if;
  -- no key (the four-argument call of before, or null): two identical orders are two orders
  select * into x from public.commit_order(pg_temp.test_order('so-brazil', 250, 1, 'bank_transfer', 'Sans Cle'), '', '', '');
  select * into y from public.commit_order(pg_temp.test_order('so-brazil', 250, 1, 'bank_transfer', 'Sans Cle'), '', '', '', null);
  if not x.created or not y.created or x.id = y.id then raise exception 'TEST FAILED: orders without a key'; end if;
  if (select count(*) from public.orders where customer_name = 'Sans Cle' and idempotency_key is null) <> 2 then
    raise exception 'TEST FAILED: keyless orders not stored without a key';
  end if;
  -- a refused order keeps its key free: the corrected one goes through with the same key
  begin
    perform public.commit_order(pg_temp.test_order('so-brazil', 250, 1, 'cashplus'), '', '', '', 'b0ca0000-0000-4000-8000-000000000029');
    raise exception 'TEST FAILED: closed method accepted';
  exception when others then if sqlerrm not like 'invalid_order:payment_method%' then raise; end if;
  end;
  if not (select created from public.commit_order(pg_temp.test_order('so-brazil', 250, 1, 'bank_transfer'), '', '', '', 'b0ca0000-0000-4000-8000-000000000029')) then
    raise exception 'TEST FAILED: key of a refused order blocked';
  end if;
end $$;
-- any other unique violation is not a repeated key: it is raised, never answered with an order
do $$
declare n bigint := (select last_value from public.order_number_seq);
begin
  perform setval('public.order_number_seq', n - 1);  -- the next number is already taken
  begin
    perform public.commit_order(pg_temp.test_order('so-brazil', 250, 1, 'bank_transfer'), '', '', '', 'b0ca0000-0000-4000-8000-000000000030');
    raise exception 'TEST FAILED: a taken order number was not raised';
  exception when unique_violation then null;
  end;
  perform setval('public.order_number_seq', n);
end $$;
-- the server's role may call it; a visitor may not (section 4 tries without a key)
set role service_role;
select count(*) from public.commit_order(pg_temp.test_order('so-brazil', 250, 1, 'bank_transfer'), '', '', '', 'b0ca0000-0000-4000-8000-000000000027');
-- the function before slice 3b is kept (renamed) until slice 11, closed even to the server
do $$ begin
  perform public.commit_order_before_3b(pg_temp.test_order('so-brazil', 250, 1, 'bank_transfer'), '', '', '');
  raise exception 'TEST FAILED: the old commit_order is still callable';
exception when insufficient_privilege then null;
end $$;
reset role;
set role anon;
do $$ begin
  perform public.commit_order('{}', '', '', '', 'b0ca0000-0000-4000-8000-000000000027');
  raise exception 'TEST FAILED: anon called commit_order with a key';
exception when insufficient_privilege then null;
end $$;
reset role;
select 'ok 27 - an order sent again with its key gives back the first one (no second row, stock or message); without a key as before' as result;
