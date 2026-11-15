-- Cash on delivery, owner decisions of 2026-11-14 (migration 20261115090000_cod_unconfirmed_expiry): a 'cod' order
-- still 'new' 24 hours after it was placed expires (cancelled, its stock back once), a confirmed one never does; only
-- the owner marks a 'cod' order delivered, a prepaid one keeps its rule; the backup phone may be the first one.
-- pgTAP, run by run-local.sh on a fresh database; the count is checked against plan().
\set ON_ERROR_STOP on
set client_min_messages = warning;
create extension if not exists pgtap;

begin;
select plan(25);

insert into auth.users values
  ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002'), ('00000000-0000-0000-0000-000000000003');
insert into public.admin_users values
  ('00000000-0000-0000-0000-000000000001', 'owner', 'Owner'),
  ('00000000-0000-0000-0000-000000000002', 'staff', 'Staff'),
  ('00000000-0000-0000-0000-000000000003', 'manager', 'Manager');
insert into public.site_config (id, settings, content) values (1, '{"b2bThresholdKg": 10, "salesOpen": true}', '{}');
insert into public.origins (id, name, country_code, species, roast_level, stock_kg, low_stock_kg, price_per_kg) values
  ('brazil', '{"fr": "Brésil"}', 'BR', 'arabica', 'medium', 50, 0, 220);
insert into public.products (id, slug, kind, name, roast_level, prices, active)
values ('signature', 'signature', 'signature', '{"fr": "Signature"}', 'medium', '{"1000": 200}', true);
insert into public.product_recipes values ('signature', 'brazil', 100);
insert into public.shipping_rates (id, city, base_fee, included_kg, extra_per_kg) values ('oujda', '{"fr": "Oujda"}', 20, 4, 10);
insert into public.payment_methods (id, label) values ('cashplus', '{"fr": "Cash Plus"}');

create function pg_temp.token(p_sub text, p_aal text) returns text language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', p_sub, 'aal', p_aal)::text, true)
$$;
-- one 1 kg bag of Signature to Oujda, paid on delivery, with these two phones
create function pg_temp.cod_order(p_phone text, p_phone_alt text) returns jsonb language sql as $$
  select jsonb_build_object('locale', 'fr',
    'customer', jsonb_build_object('fullName', 'Client Test', 'phone', p_phone, 'phoneAlt', p_phone_alt, 'cityId', 'oujda', 'address', '12 rue Test'),
    'lines', jsonb_build_array(jsonb_build_object('kind', 'product', 'productId', 'signature', 'name', '{"fr": "Signature"}', 'size', 1000, 'qty', 1,
      'unitPrice', 200, 'lineTotal', 200, 'composition', '[{"originId": "brazil", "percent": 100, "grams": 1000}]'::jsonb)),
    'weightKg', 1, 'subtotal', 200, 'shippingFee', 20, 'total', 220, 'paymentMethod', 'cod',
    'stockDeductions', '[{"originId": "brazil", "kg": 1}]'::jsonb)
$$;
create function pg_temp.place(p_phone text default '+212612345678', p_phone_alt text default '+212712345678') returns uuid language sql as $$
  select id from public.commit_order(pg_temp.cod_order(p_phone, p_phone_alt), '', '', '')
$$;
create function pg_temp.state(p_id uuid) returns text language sql as $$
  select status || ' ' || payment_status || ' ' || stock_returned from public.orders where id = p_id
$$;
create function pg_temp.stock() returns numeric language sql as $$ select stock_kg from public.origins where id = 'brazil' $$;

-- the backup phone: the same number as the first one is accepted, a different one too (owner, 2026-11-14)
select set_config('test.same', pg_temp.place('+212612345678', '06 12 34 56 78')::text, true);
select is((select phone || ' ' || phone_alt from public.orders where id = current_setting('test.same')::uuid),
          '+212612345678 +212612345678', 'a backup phone equal to the first one is accepted and stored');
select set_config('test.other', pg_temp.place('+212612345678', '+212712345678')::text, true);
select is((select phone_alt from public.orders where id = current_setting('test.other')::uuid), '+212712345678',
          'a different backup phone is accepted and stored');

-- four more orders, aged by hand: 25 h, exactly 24 h, 23 h, and confirmed 30 days ago
select set_config('test.h25', pg_temp.place()::text, true);
select set_config('test.h24', pg_temp.place()::text, true);
select set_config('test.h23', pg_temp.place()::text, true);
select set_config('test.old_confirmed', pg_temp.place()::text, true);
update public.orders set created_at = now() - interval '25 hours' where id = current_setting('test.h25')::uuid;
update public.orders set created_at = now() - interval '24 hours' where id = current_setting('test.h24')::uuid;
update public.orders set created_at = now() - interval '23 hours' where id = current_setting('test.h23')::uuid;
update public.orders set created_at = now() - interval '30 days', status = 'confirmed' where id = current_setting('test.old_confirmed')::uuid;
-- the two phone orders stay as placed (now): six orders, 6 kg taken
select is(pg_temp.stock(), 44.000, 'six cod orders took 6 kg');

-- the expiry (the server's own job, every 15 minutes)
select is(public.expire_unpaid_orders(), 2, 'expiry: the two unconfirmed cod orders of 24 hours or more expire');
select is(pg_temp.state(current_setting('test.h25')::uuid), 'cancelled pending true', 'expiry: new for 25 hours: cancelled, stock back');
select is(pg_temp.state(current_setting('test.h24')::uuid), 'cancelled pending true', 'expiry: new for exactly 24 hours: cancelled, stock back');
select is(pg_temp.state(current_setting('test.h23')::uuid), 'new pending false', 'expiry: new for 23 hours: still waiting');
select is(pg_temp.state(current_setting('test.old_confirmed')::uuid), 'confirmed pending false', 'expiry: a confirmed cod order never expires');
select is(pg_temp.stock(), 46.000, 'expiry: the 2 kg of the two expired orders are back');
select is((select count(*)::int from public.stock_movements where reason = 'order_cancelled' and note = 'auto' and delta_kg = 1), 2,
          'expiry: one stock movement per expired order');
select is((select count(*)::int from public.order_events where label = 'status.expired'), 2, 'expiry: one event per expired order');
select is(public.expire_unpaid_orders(), 0, 'expiry again: nothing more expires');
select is(pg_temp.stock(), 46.000, 'expiry again: no stock given back twice');

-- the delivery of a cod order: the owner's alone (owner, 2026-11-14); every step before it, any admin
select set_config('test.d', pg_temp.place()::text, true);
set local role authenticated;
select pg_temp.token('00000000-0000-0000-0000-000000000002', 'aal2');
select lives_ok(format($$select public.set_order_status(%L, s) from unnest(array['confirmed', 'in_production', 'shipped']) s$$,
                       current_setting('test.d')), 'staff: a cod order is confirmed, prepared and shipped, as before');
select throws_ok(format($$select public.set_order_status(%L, 'delivered')$$, current_setting('test.d')), 'P0001', 'owner_only',
                 'staff: a cod order is not marked delivered');
select pg_temp.token('00000000-0000-0000-0000-000000000003', 'aal2');
select throws_ok(format($$select public.set_order_status(%L, 'delivered')$$, current_setting('test.d')), 'P0001', 'owner_only',
                 'manager: a cod order is not marked delivered');
select pg_temp.token('00000000-0000-0000-0000-000000000001', 'aal1');
select throws_ok(format($$select public.set_order_status(%L, 'delivered')$$, current_setting('test.d')), 'P0001', 'forbidden',
                 'owner at aal1: refused, as before');
select pg_temp.token('00000000-0000-0000-0000-000000000001', 'aal2');
select lives_ok(format($$select public.set_order_status(%L, 'delivered')$$, current_setting('test.d')), 'owner: a cod order is marked delivered');
reset role;
select is(pg_temp.state(current_setting('test.d')::uuid), 'delivered pending false', 'the cod order is delivered, unpaid until the owner records the money');
select is((select actor::text from public.order_events where order_id = current_setting('test.d')::uuid and label = 'status.delivered'),
          '00000000-0000-0000-0000-000000000001', 'the delivery records the owner');

-- a failed cod delivery, then shipped again: still the owner's to mark delivered; the failure itself stays any admin's
select set_config('test.f', pg_temp.place()::text, true);
set local role authenticated;
select pg_temp.token('00000000-0000-0000-0000-000000000002', 'aal2');
select public.set_order_status(current_setting('test.f')::uuid, s) from unnest(array['confirmed', 'in_production', 'shipped']) s;
select lives_ok(format($$select public.record_delivery_failure(%L, 'Client absent')$$, current_setting('test.f')),
                'staff: a failed delivery is recorded, as before');
select lives_ok(format($$select public.set_order_status(%L, 'shipped')$$, current_setting('test.f')), 'staff: shipped again, as before');
select throws_ok(format($$select public.set_order_status(%L, 'delivered')$$, current_setting('test.f')), 'P0001', 'owner_only',
                 'staff: still not delivered after a second try');
reset role;

-- a prepaid order keeps its rule: any admin marks it delivered once it is paid and shipped
insert into public.orders (id, number, customer_name, phone, city_id, address, lines, weight_kg, subtotal, shipping_fee, total,
                           payment_method, payment_status, status, stock_deductions) values
  ('10000000-0000-4000-8000-0000000000a3', 'BC-TEST-P3', 'TEST', '+212600000000', 'oujda', 'TEST', '[]', 1, 200, 20, 220,
   'cashplus', 'paid', 'shipped', '[{"originId": "brazil", "kg": 1}]');
set local role authenticated;
select pg_temp.token('00000000-0000-0000-0000-000000000002', 'aal2');
select lives_ok($$select public.set_order_status('10000000-0000-4000-8000-0000000000a3', 'delivered')$$, 'staff: a paid prepaid order is marked delivered, as before');
reset role;
select is(pg_temp.state('10000000-0000-4000-8000-0000000000a3'), 'delivered paid false', 'the prepaid order is delivered');

select * from finish(true);
rollback;
