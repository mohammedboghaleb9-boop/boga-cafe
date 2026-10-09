-- Admin writes (P5 slice 8): orders, stock and B2B follow-up go through the server's
-- functions, only at aal2, within each role's limits, and record who did it.
-- pgTAP, run by run-local.sh on a fresh database; the count is checked against plan().
\set ON_ERROR_STOP on
set client_min_messages = warning;
create extension if not exists pgtap;

begin;
select plan(23);

insert into auth.users values
  ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002'), ('00000000-0000-0000-0000-000000000003');
insert into public.admin_users values
  ('00000000-0000-0000-0000-000000000001', 'owner', 'Owner'),
  ('00000000-0000-0000-0000-000000000002', 'staff', 'Staff'),
  ('00000000-0000-0000-0000-000000000003', 'manager', 'Manager');
insert into public.origins (id, name, country_code, species, roast_level, price_per_kg) values
  ('brazil', '{"fr": "Brésil"}', 'BR', 'arabica', 'medium', 220);
insert into public.shipping_rates (id, city, base_fee) values ('oujda', '{"fr": "Oujda"}', 20);
insert into public.payment_methods (id, label) values ('cashplus', '{"fr": "Cash Plus"}');
insert into public.orders (id, number, customer_name, phone, city_id, address, lines, weight_kg, subtotal, shipping_fee, total,
                           payment_method, stock_deductions) values
  ('10000000-0000-4000-8000-000000000001', 'BC-TEST-1', 'TEST', '0600000000', 'oujda', 'TEST', '[]', 0.25, 60, 20, 80,
   'cashplus', '[{"originId": "brazil", "kg": 0.25}]'),
  ('10000000-0000-4000-8000-000000000002', 'BC-TEST-2', 'TEST', '0600000000', 'oujda', 'TEST', '[]', 0.25, 60, 20, 80,
   'cashplus', '[{"originId": "brazil", "kg": 0.25}]');
insert into public.quote_requests (id, number, business_type, contact_name, phone, city_id, lines, weight_kg, indicative_total) values
  ('20000000-0000-4000-8000-000000000001', 'QR-TEST-1', 'cafe', 'TEST', '0600000000', 'oujda', '[]', 30, 6000);

create function pg_temp.token(p_sub text, p_aal text) returns text language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', p_sub, 'aal', p_aal)::text, true)
$$;
-- the follow-up's version, as the page read it
create function pg_temp.seen() returns timestamptz language sql as $$ select updated_at from public.quote_requests $$;
set local role authenticated;

-- at aal1 (password only) every write is refused
select pg_temp.token('00000000-0000-0000-0000-000000000001', 'aal1');
select throws_ok($$select public.set_order_status('10000000-0000-4000-8000-000000000001', 'cancelled')$$, 'P0001', 'forbidden', 'owner at aal1: order status refused');
select throws_ok($$select public.set_payment_status('10000000-0000-4000-8000-000000000001', 'paid')$$, 'P0001', 'forbidden', 'owner at aal1: payment refused');
select throws_ok($$select public.update_quote_request('20000000-0000-4000-8000-000000000001', 'closed', null, '', pg_temp.seen())$$, 'P0001', 'forbidden', 'owner at aal1: B2B follow-up refused');

-- staff: orders and stock yes, money no
select pg_temp.token('00000000-0000-0000-0000-000000000002', 'aal2');
select throws_ok($$select public.set_payment_status('10000000-0000-4000-8000-000000000001', 'paid')$$, 'P0001', 'forbidden', 'staff: "paid" is the owner''s');
select lives_ok($$select public.set_order_status('10000000-0000-4000-8000-000000000002', 'cancelled')$$, 'staff: cancels an unpaid new order');
select is((select actor::text from public.order_events where order_id = '10000000-0000-4000-8000-000000000002' and label = 'status.cancelled'),
          '00000000-0000-0000-0000-000000000002', 'staff: the cancel records who did it');
select lives_ok($$select public.adjust_stock('brazil', 2, 'restock', 'TEST lot')$$, 'staff: adjusts stock');
select is((select actor::text from public.stock_movements where reason = 'restock'), '00000000-0000-0000-0000-000000000002', 'staff: the stock line records who did it');
select lives_ok($$select public.update_quote_request('20000000-0000-4000-8000-000000000001', 'negotiating', 5500, 'TEST call back', pg_temp.seen())$$, 'staff: follows up a B2B request');
select is((select status || ' ' || final_price || ' ' || admin_notes || ' ' || updated_by from public.quote_requests),
          'negotiating 5500.00 TEST call back 00000000-0000-0000-0000-000000000002', 'staff: status, price and notes saved, with who did it');
select throws_ok($$select public.update_quote_request('20000000-0000-4000-8000-000000000001', 'closed', null, '', '2026-01-01')$$, 'P0001', 'stale',
                 'B2B: a follow-up from an old copy of the page is refused, never written over the newer one');

-- the follow-up checks what it saves
select throws_ok($$select public.update_quote_request('20000000-0000-4000-8000-000000000001', 'won', null, '', pg_temp.seen())$$, 'P0001', 'invalid_status', 'B2B: unknown status refused');
select throws_ok($$select public.update_quote_request('20000000-0000-4000-8000-000000000001', 'closed', 'NaN', '', pg_temp.seen())$$, 'P0001', 'invalid_price', 'B2B: NaN price refused');
select throws_ok($$select public.update_quote_request('20000000-0000-4000-8000-000000000001', 'closed', null, repeat('x', 501), pg_temp.seen())$$, 'P0001', 'invalid_notes', 'B2B: notes over 500 characters refused');

-- no role writes these tables directly through the API, only through the functions above
select throws_ok($$update public.quote_requests set phone = '0700000000'$$, '42501', null, 'staff: a B2B request cannot be rewritten directly');
select throws_ok($$delete from public.quote_requests$$, '42501', null, 'staff: a B2B request cannot be deleted directly');
select throws_ok($$insert into public.quote_requests (number, business_type, contact_name, phone, city_id, lines, weight_kg, indicative_total)
                  values ('QR-FAKE', 'cafe', 'X', '0', 'oujda', '[]', 1, 1)$$, '42501', null, 'staff: a B2B request cannot be inserted directly');
select pg_temp.token('00000000-0000-0000-0000-000000000003', 'aal2');
select throws_ok($$delete from public.stock_movements$$, '42501', null, 'manager: stock history cannot be deleted directly');
select throws_ok($$update public.notification_outbox set status = 'sent'$$, '42501', null, 'manager: the message queue cannot be changed directly');

-- the owner records the payment; the order moves on and says who did it
select pg_temp.token('00000000-0000-0000-0000-000000000001', 'aal2');
select throws_ok($$update public.orders set payment_status = 'paid'$$, '42501', null, 'owner: an order is not changed directly, only through its functions');
select throws_ok($$insert into public.order_events (order_id, label) values ('10000000-0000-4000-8000-000000000001', 'payment.paid')$$, '42501', null,
                 'owner: order history cannot be written directly');
select lives_ok($$select public.set_payment_status('10000000-0000-4000-8000-000000000001', 'paid')$$, 'owner: marks paid');
select is((select status || ' ' || payment_status from public.orders where id = '10000000-0000-4000-8000-000000000001'), 'confirmed paid',
          'owner: paid confirms the new order');

reset role;
select * from finish(true);
rollback;
