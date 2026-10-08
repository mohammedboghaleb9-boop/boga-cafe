-- Admin writes (P5 slice 8): orders, stock and B2B follow-up go through the server's
-- functions, only at aal2, within each role's limits, and record who did it.
-- pgTAP, run by run-local.sh on a fresh database; the count is checked against plan().
\set ON_ERROR_STOP on
set client_min_messages = warning;
create extension if not exists pgtap;

begin;
select plan(17);

insert into auth.users values
  ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002');
insert into public.admin_users values
  ('00000000-0000-0000-0000-000000000001', 'owner', 'Owner'),
  ('00000000-0000-0000-0000-000000000002', 'staff', 'Staff');
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
set local role authenticated;

-- at aal1 (password only) every write is refused
select pg_temp.token('00000000-0000-0000-0000-000000000001', 'aal1');
select throws_ok($$select public.set_order_status('10000000-0000-4000-8000-000000000001', 'cancelled')$$, 'P0001', 'forbidden', 'owner at aal1: order status refused');
select throws_ok($$select public.set_payment_status('10000000-0000-4000-8000-000000000001', 'paid')$$, 'P0001', 'forbidden', 'owner at aal1: payment refused');
select throws_ok($$select public.update_quote_request('20000000-0000-4000-8000-000000000001', 'closed', null, '')$$, 'P0001', 'forbidden', 'owner at aal1: B2B follow-up refused');

-- staff: orders and stock yes, money no
select pg_temp.token('00000000-0000-0000-0000-000000000002', 'aal2');
select throws_ok($$select public.set_payment_status('10000000-0000-4000-8000-000000000001', 'paid')$$, 'P0001', 'forbidden', 'staff: "paid" is the owner''s');
select lives_ok($$select public.set_order_status('10000000-0000-4000-8000-000000000002', 'cancelled')$$, 'staff: cancels an unpaid new order');
select is((select actor::text from public.order_events where order_id = '10000000-0000-4000-8000-000000000002' and label = 'status.cancelled'),
          '00000000-0000-0000-0000-000000000002', 'staff: the cancel records who did it');
select lives_ok($$select public.adjust_stock('brazil', 2, 'restock', 'TEST lot')$$, 'staff: adjusts stock');
select is((select actor::text from public.stock_movements where reason = 'restock'), '00000000-0000-0000-0000-000000000002', 'staff: the stock line records who did it');
select lives_ok($$select public.update_quote_request('20000000-0000-4000-8000-000000000001', 'negotiating', 5500, 'TEST call back')$$, 'staff: follows up a B2B request');
select is((select status || ' ' || final_price || ' ' || admin_notes from public.quote_requests), 'negotiating 5500.00 TEST call back', 'staff: status, price and notes saved');

-- the follow-up checks what it saves
select throws_ok($$select public.update_quote_request('20000000-0000-4000-8000-000000000001', 'won', null, '')$$, 'P0001', 'invalid_status', 'B2B: unknown status refused');
select throws_ok($$select public.update_quote_request('20000000-0000-4000-8000-000000000001', 'closed', 'NaN', '')$$, 'P0001', 'invalid_price', 'B2B: NaN price refused');
select throws_ok($$select public.update_quote_request('20000000-0000-4000-8000-000000000001', 'closed', null, repeat('x', 501))$$, 'P0001', 'invalid_notes', 'B2B: notes over 500 characters refused');

-- an admin cannot rewrite or remove a request through the API, only follow it up
update public.quote_requests set phone = '0700000000';
delete from public.quote_requests;
select is((select phone from public.quote_requests), '0600000000', 'B2B: a direct update or delete changes nothing');
select throws_ok($$insert into public.quote_requests (number, business_type, contact_name, phone, city_id, lines, weight_kg, indicative_total)
                  values ('QR-FAKE', 'cafe', 'X', '0', 'oujda', '[]', 1, 1)$$, '42501', null, 'B2B: a direct insert is refused');

-- the owner records the payment; the order moves on and says who did it
select pg_temp.token('00000000-0000-0000-0000-000000000001', 'aal2');
select lives_ok($$select public.set_payment_status('10000000-0000-4000-8000-000000000001', 'paid')$$, 'owner: marks paid');
select is((select status || ' ' || payment_status from public.orders where id = '10000000-0000-4000-8000-000000000001'), 'confirmed paid',
          'owner: paid confirms the new order');

reset role;
select * from finish(true);
rollback;
