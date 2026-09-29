-- Smoke test of the BOGA CAFÉ schema. Every block raises an exception if a rule is broken.
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
insert into public.site_config values (1, '{"b2bThresholdKg": 10, "unpaidOrderTimeoutHours": 48, "bank": {"rib": "OWNER-RIB"}}', '{}');
insert into public.origins (id, name, country_code, species, roast_level, stock_kg, low_stock_kg, price_per_kg) values
  ('brazil',  '{"fr": "Brésil"}',  'BR', 'arabica', 'medium', 10, 2, 220),
  ('vietnam', '{"fr": "Viêt Nam"}', 'VN', 'robusta', 'dark',   1, 0.5, 150);
insert into public.shipping_rates (id, city, base_fee) values ('oujda', '{"fr": "Oujda"}', 20);
insert into public.payment_methods (id, label) values ('card', '{"fr": "Carte"}'), ('bank_transfer', '{"fr": "Virement"}');
begin;
insert into public.products (id, slug, kind, name, roast_level, prices, active)
values ('signature', 'signature', 'signature', '{"fr": "Signature"}', 'medium', '{"1000": 225}', true);
insert into public.product_recipes values ('signature', 'brazil', 80), ('signature', 'vietnam', 20);
commit;

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
  '{"locale": "fr", "customer": {"fullName": "Test", "phone": "+212612345678", "cityId": "oujda", "address": "Rue 1"},
    "lines": [], "weightKg": 1, "subtotal": 225, "shippingFee": 20, "total": 245, "paymentMethod": "card",
    "stockDeductions": [{"originId": "brazil", "kg": 0.8}, {"originId": "vietnam", "kg": 0.2}]}',
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
    perform public.commit_order(
      '{"customer": {"fullName": "X", "phone": "1", "cityId": "oujda", "address": "a"}, "lines": [], "weightKg": 5,
        "subtotal": 1, "shippingFee": 1, "total": 2, "paymentMethod": "card",
        "stockDeductions": [{"originId": "brazil", "kg": 1}, {"originId": "vietnam", "kg": 5}]}', '', '', '');
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
  if (select count(*) from public.products) <> 1 then raise exception 'TEST FAILED: anon catalog'; end if;
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
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
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
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
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
    perform public.commit_order(
      '{"customer": {"fullName": "X", "phone": "1", "cityId": "oujda", "address": "a"}, "lines": [], "weightKg": 1,
        "subtotal": -40, "shippingFee": 20, "total": -20, "paymentMethod": "card", "stockDeductions": [{"originId": "brazil", "kg": 0.1}]}', '', '', '');
    raise exception 'TEST FAILED: negative total accepted';
  exception when check_violation then null;
  end;
  if (select stock_kg from public.origins where id = 'brazil') <> 10 then raise exception 'TEST FAILED: stock moved by a refused order'; end if;
  perform setval('public.order_number_seq', 9999);
  if (select number from public.commit_order(
        '{"customer": {"fullName": "X", "phone": "1", "cityId": "oujda", "address": "a"}, "lines": [], "weightKg": 0.1,
          "subtotal": 22, "shippingFee": 20, "total": 42, "paymentMethod": "bank_transfer", "stockDeductions": [{"originId": "brazil", "kg": 0.1}]}',
        '', '', '')) not like 'BC-%-10000' then
    raise exception 'TEST FAILED: order 10000 numbering';
  end if;
end $$;
select 'ok 7 - no negative, empty or free orders; numbering past 9999' as result;

-- 8. Stock moves only through the functions (never a direct UPDATE) ---------
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
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
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true); -- staff
  set local role authenticated;
  perform public.set_order_status(v_id, 'confirmed');
  begin perform public.set_order_status(v_id, 'in_production'); raise exception 'TEST FAILED: produced unpaid';
  exception when others then if sqlerrm <> 'needs_payment' then raise; end if; end;
  begin perform public.set_order_status(v_id, 'delivered'); raise exception 'TEST FAILED: skipped steps';
  exception when others then if sqlerrm <> 'not_next' then raise; end if; end;
  begin perform public.set_payment_status(v_id, 'paid'); raise exception 'TEST FAILED: staff marked paid';
  exception when others then if sqlerrm <> 'forbidden' then raise; end if; end;
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true); -- manager
  begin perform public.set_payment_status(v_id, 'paid'); raise exception 'TEST FAILED: manager marked paid';
  exception when others then if sqlerrm <> 'forbidden' then raise; end if; end;
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true); -- owner
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
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003';
do $$ begin
  begin
    update public.site_config set settings = jsonb_set(settings, '{bank,rib}', '"ATTACKER-RIB"') where id = 1;
    raise exception 'TEST FAILED: manager changed the RIB';
  exception when others then
    if sqlerrm <> 'owner_only' then raise; end if;
  end;
  update public.site_config set content = '{"heroTitle": {"fr": "Nouveau"}}' where id = 1;
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
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
  select id into v_id from public.commit_order(
    '{"customer": {"fullName": "Late", "phone": "1", "cityId": "oujda", "address": "a"}, "lines": [], "weightKg": 0.5,
      "subtotal": 110, "shippingFee": 20, "total": 130, "paymentMethod": "bank_transfer", "stockDeductions": [{"originId": "brazil", "kg": 0.5}]}',
    '', '', '');
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
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
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
  select id into v_id from public.commit_order(
    '{"customer": {"fullName": "Annule", "phone": "1", "cityId": "oujda", "address": "a"}, "lines": [], "weightKg": 0.1,
      "subtotal": 22, "shippingFee": 20, "total": 42, "paymentMethod": "bank_transfer", "stockDeductions": [{"originId": "brazil", "kg": 0.1}]}',
    '', '', '');
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true); -- owner
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
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003';
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
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003';
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
  select id into v_id from public.commit_order(
    '{"customer": {"fullName": "Rembourse", "phone": "1", "cityId": "oujda", "address": "a"}, "lines": [], "weightKg": 0.2,
      "subtotal": 44, "shippingFee": 20, "total": 64, "paymentMethod": "card", "stockDeductions": [{"originId": "brazil", "kg": 0.2}]}',
    '', '', '');
  v_before := (select stock_kg from public.origins where id = 'brazil');
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true); -- owner
  set local role authenticated;
  perform public.set_payment_status(v_id, 'paid');      -- new → confirmed
  perform public.set_payment_status(v_id, 'refunded');  -- customer changed their mind
  reset role;
  if (select status from public.orders where id = v_id) <> 'cancelled' then raise exception 'TEST FAILED: refunded order left open'; end if;
  if (select stock_kg from public.origins where id = 'brazil') <> v_before + 0.2 then raise exception 'TEST FAILED: stock not returned on refund'; end if;
  if (select count(*) from public.order_events where order_id = v_id and label in ('payment.refunded', 'status.cancelled')) <> 2 then raise exception 'TEST FAILED: history'; end if;
end $$;
select 'ok 16 - a refund before production cancels the order and returns the stock' as result;

-- 17. The free-shipping threshold stays a number ------------------------------
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003'; -- manager
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
  select id, number into v_id, v_number from public.commit_order(
    '{"customer": {"fullName": "Virement", "phone": "+212661000000", "cityId": "oujda", "address": "12 rue Test"}, "lines": [], "weightKg": 0.1,
      "subtotal": 22, "shippingFee": 20, "total": 42, "paymentMethod": "bank_transfer", "stockDeductions": [{"originId": "brazil", "kg": 0.1}]}',
    '', '', '');
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
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002'; -- staff
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

-- 20. Sample and B2B requests keep the same text limits as orders; origins a real price
do $$
declare
  t text; col text; c text; v text; num text;
  val text[];
begin
  -- each text column of both tables, one character over its limit
  foreach t in array array['sample_requests', 'quote_requests'] loop
    foreach col in array array['company:81', 'contact_name:81', 'phone:25', 'email:121', 'notes:501'] loop
      c := split_part(col, ':', 1);
      v := repeat('x', split_part(col, ':', 2)::int);
      num := case t when 'sample_requests' then 'SR' else 'QR' end || '-2026-L' || upper(left(md5(col), 5));
      -- company, contact_name, phone, email, notes: valid values except the one under test
      val := array[case c when 'company' then v else '' end, case c when 'contact_name' then v else 'Sara' end,
                   case c when 'phone' then v else '1' end, case c when 'email' then v else '' end, case c when 'notes' then v else '' end];
      begin
        if t = 'sample_requests' then
          insert into public.sample_requests (number, business_type, company, contact_name, phone, email, notes, city_id, product_id)
          values (num, 'cafe', val[1], val[2], val[3], val[4], val[5], 'oujda', 'signature');
        else
          insert into public.quote_requests (number, business_type, company, contact_name, phone, email, notes, city_id, lines, weight_kg, indicative_total)
          values (num, 'cafe', val[1], val[2], val[3], val[4], val[5], 'oujda', '[]', 11, 100);
        end if;
        raise exception 'TEST FAILED: %.% accepted % characters', t, c, length(v);
      exception when check_violation then null;
      end;
    end loop;
  end loop;
  insert into public.sample_requests (number, business_type, contact_name, phone, city_id, product_id, notes)
  values ('SR-2026-OK0001', 'cafe', 'Sara', '+212661000000', 'oujda', 'signature', repeat('x', 500));
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
select 'ok 20 - sample and B2B requests have the same length limits as orders; origins have a real price' as result;

-- 21. Stock and amounts are real numbers: 'NaN' is a valid numeric that sorts above
--     every number, so "stock_kg >= 0" alone accepted it (audit H1) ---------------
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002'; -- staff
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
