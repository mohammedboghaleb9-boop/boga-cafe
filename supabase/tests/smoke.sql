-- Smoke test of the BOGA CAFÉ schema. Every block raises an exception if a rule is broken.
\set ON_ERROR_STOP on
set client_min_messages = warning;

-- Seed ------------------------------------------------------------------
insert into auth.users values ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002');
insert into public.admin_users values
  ('00000000-0000-0000-0000-000000000001', 'owner', 'Owner'),
  ('00000000-0000-0000-0000-000000000002', 'staff', 'Staff');
insert into public.admin_config values (1, '+212600000000', 'admin@example.com', true, true);
insert into public.site_config values (1, '{"b2bThresholdKg": 10}', '{}');
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
    if sqlerrm <> 'order_cancelled' then raise; end if;
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
