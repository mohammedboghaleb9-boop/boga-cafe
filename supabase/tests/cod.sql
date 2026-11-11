-- Cash on delivery (20261110120000_cod): a 'cod' order is prepared, shipped and delivered unpaid, never expires and
-- takes no "I have paid" report; its money is the owner's, in two separate steps after the delivery; a failed
-- delivery keeps its reason and moves no stock; a prepaid order keeps every rule it had.
-- pgTAP, run by run-local.sh on a fresh database; the count is checked against plan().
\set ON_ERROR_STOP on
set client_min_messages = warning;
create extension if not exists pgtap;

begin;
select plan(49);

insert into auth.users values ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002');
insert into public.admin_users values
  ('00000000-0000-0000-0000-000000000001', 'owner', 'Owner'),
  ('00000000-0000-0000-0000-000000000002', 'staff', 'Staff');
insert into public.origins (id, name, country_code, species, roast_level, price_per_kg, stock_kg) values
  ('brazil', '{"fr": "Brésil"}', 'BR', 'arabica', 'medium', 220, 10);
insert into public.shipping_rates (id, city, base_fee) values ('oujda', '{"fr": "Oujda"}', 20);
insert into public.payment_methods (id, label) values ('cashplus', '{"fr": "Cash Plus"}');

select is((select enabled::text || ' ' || (label ->> 'fr') from public.payment_methods where id = 'cod'),
          'true Paiement à la livraison', 'the migration adds the method, switched on');

-- C1: the whole path; C2: cancelled; C3: old, must not expire; C4: fails and comes back; P1: prepaid and old; P2: prepaid
insert into public.orders (id, number, created_at, customer_name, phone, phone_alt, city_id, address, lines, weight_kg, subtotal,
                           shipping_fee, total, payment_method, stock_deductions) values
  ('10000000-0000-4000-8000-0000000000c1', 'BC-TEST-C1', now(), 'TEST', '+212600000000', '+212700000000', 'oujda', 'TEST', '[]', 0.25, 60, 20, 80,
   'cod', '[{"originId": "brazil", "kg": 0.25}]'),
  ('10000000-0000-4000-8000-0000000000c2', 'BC-TEST-C2', now(), 'TEST', '+212600000000', '+212700000000', 'oujda', 'TEST', '[]', 0.25, 60, 20, 80,
   'cod', '[{"originId": "brazil", "kg": 0.25}]'),
  ('10000000-0000-4000-8000-0000000000c3', 'BC-TEST-C3', now() - interval '30 days', 'TEST', '+212600000000', '+212700000000', 'oujda', 'TEST', '[]',
   0.25, 60, 20, 80, 'cod', '[{"originId": "brazil", "kg": 0.25}]'),
  ('10000000-0000-4000-8000-0000000000c4', 'BC-TEST-C4', now(), 'TEST', '+212600000000', '+212700000000', 'oujda', 'TEST', '[]', 0.25, 60, 20, 80,
   'cod', '[{"originId": "brazil", "kg": 0.25}]'),
  ('10000000-0000-4000-8000-0000000000a1', 'BC-TEST-P1', now() - interval '30 days', 'TEST', '+212600000000', '', 'oujda', 'TEST', '[]',
   0.25, 60, 20, 80, 'cashplus', '[{"originId": "brazil", "kg": 0.25}]'),
  ('10000000-0000-4000-8000-0000000000a2', 'BC-TEST-P2', now(), 'TEST', '+212600000000', '', 'oujda', 'TEST', '[]', 0.25, 60, 20, 80,
   'cashplus', '[{"originId": "brazil", "kg": 0.25}]');

-- P3: prepaid, paid and shipped
insert into public.orders (id, number, customer_name, phone, city_id, address, lines, weight_kg, subtotal, shipping_fee, total,
                           payment_method, payment_status, status, stock_deductions) values
  ('10000000-0000-4000-8000-0000000000a3', 'BC-TEST-P3', 'TEST', '+212600000000', 'oujda', 'TEST', '[]', 0.25, 60, 20, 80,
   'cashplus', 'paid', 'shipped', '[{"originId": "brazil", "kg": 0.25}]');

create function pg_temp.token(p_sub text, p_aal text) returns text language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', p_sub, 'aal', p_aal)::text, true)
$$;
create function pg_temp.state(p_id uuid) returns text language sql as $$
  select status || ' ' || payment_status from public.orders where id = p_id
$$;
create function pg_temp.stock() returns numeric language sql as $$ select stock_kg from public.origins where id = 'brazil' $$;

-- the expiry (the server's own job): the old prepaid order goes, the old 'cod' order stays
select is(public.expire_unpaid_orders(), 1, 'expiry: one order expires');
select is(pg_temp.state('10000000-0000-4000-8000-0000000000a1'), 'cancelled pending', 'expiry: the old unpaid Cash Plus order is cancelled, as before');
select is(pg_temp.state('10000000-0000-4000-8000-0000000000c3'), 'new pending', 'expiry: the old unpaid cod order is left alone');
select is(pg_temp.stock(), 10.250, 'expiry: the stock of the expired order is back, as before');

-- the customer's "I have paid": not for a cod order, still for a prepaid one
set local role anon;
select lives_ok($$select public.report_offline_payment('10000000-0000-4000-8000-0000000000c1', 'REF')$$, 'cod: a payment report answers nothing');
select lives_ok($$select public.report_offline_payment('10000000-0000-4000-8000-0000000000a2', 'REF')$$, 'Cash Plus: a payment report is taken');
select throws_ok($$select public.record_delivery_failure('10000000-0000-4000-8000-0000000000c1', 'Client absent')$$, '42501', null,
                 'a visitor cannot record a failed delivery');
reset role;
select is(pg_temp.state('10000000-0000-4000-8000-0000000000c1'), 'new pending', 'cod: the report changed nothing');
select is(pg_temp.state('10000000-0000-4000-8000-0000000000a2'), 'new awaiting_verification', 'Cash Plus: the report waits for the owner, as before');

set local role authenticated;

-- at aal1 nothing
select pg_temp.token('00000000-0000-0000-0000-000000000001', 'aal1');
select throws_ok($$select public.record_delivery_failure('10000000-0000-4000-8000-0000000000c1', 'Client absent')$$, 'P0001', 'forbidden',
                 'owner at aal1: a failed delivery is refused');

-- staff: the delivery steps of a cod order, unpaid; a prepaid order still waits for its payment
select pg_temp.token('00000000-0000-0000-0000-000000000002', 'aal2');
select lives_ok($$select public.set_order_status('10000000-0000-4000-8000-0000000000c1', 'confirmed')$$, 'cod: confirmed');
select lives_ok($$select public.set_order_status('10000000-0000-4000-8000-0000000000c1', 'in_production')$$, 'cod: prepared unpaid');
select lives_ok($$select public.set_order_status('10000000-0000-4000-8000-0000000000c1', 'shipped')$$, 'cod: shipped unpaid');
select lives_ok($$select public.set_order_status('10000000-0000-4000-8000-0000000000a2', 'confirmed')$$, 'Cash Plus: confirmed, as before');
select throws_ok($$select public.set_order_status('10000000-0000-4000-8000-0000000000a2', 'in_production')$$, 'P0001', 'needs_payment',
                 'Cash Plus: nothing is prepared before the payment, as before');
select throws_ok($$select public.set_payment_status('10000000-0000-4000-8000-0000000000c1', 'collected')$$, 'P0001', 'forbidden',
                 'staff: the money of a cod order is the owner''s');

-- a failed delivery: through its own function, with a reason; tried again or returned; the stock does not move
select throws_ok($$select public.set_order_status('10000000-0000-4000-8000-0000000000c1', 'delivery_failed')$$, 'P0001', 'reason_required',
                 'a failed delivery is not a plain status change');
select throws_ok($$select public.record_delivery_failure('10000000-0000-4000-8000-0000000000c1', '  ')$$, 'P0001', 'invalid_reason',
                 'a failed delivery wants its reason');
select throws_ok($$select public.record_delivery_failure('10000000-0000-4000-8000-0000000000c1', repeat('x', 201))$$, 'P0001', 'invalid_reason',
                 'the reason is at most 200 characters');
select throws_ok($$select public.record_delivery_failure('10000000-0000-4000-8000-0000000000c2', 'Client absent')$$, 'P0001', 'not_next',
                 'only a shipped order can fail its delivery');
select throws_ok($$select public.record_delivery_failure('10000000-0000-4000-8000-0000000000a3', 'Client absent')$$, 'P0001', 'not_next',
                 'a shipped prepaid order never takes the failed-delivery path (no refund rule for it)');
select lives_ok($$select public.record_delivery_failure('10000000-0000-4000-8000-0000000000c1', E'  Client   absent\n ')$$, 'a failed delivery is recorded');
select is((select status || '|' || failure_reason from public.orders where id = '10000000-0000-4000-8000-0000000000c1'),
          'delivery_failed|Client absent', 'the status and the tidied reason are kept');
select is((select actor::text from public.order_events where order_id = '10000000-0000-4000-8000-0000000000c1' and label = 'status.delivery_failed'),
          '00000000-0000-0000-0000-000000000002', 'the failure records who noted it');
select throws_ok($$select public.set_order_status('10000000-0000-4000-8000-0000000000c1', 'cancelled')$$, 'P0001', 'too_late_to_cancel',
                 'a failed delivery is not cancelled: it is tried again or it comes back');
select throws_ok($$select public.set_order_status('10000000-0000-4000-8000-0000000000c1', 'delivered')$$, 'P0001', 'not_next',
                 'a failed delivery is shipped again before it is delivered');
select lives_ok($$select public.set_order_status('10000000-0000-4000-8000-0000000000c1', 'shipped')$$, 'a failed delivery is tried again');

-- the money before the delivery: nothing
select pg_temp.token('00000000-0000-0000-0000-000000000001', 'aal2');
select throws_ok($$select public.set_payment_status('10000000-0000-4000-8000-0000000000c1', 'collected')$$, 'P0001', 'invalid_transition',
                 'cod: nothing is collected before the delivery');
select throws_ok($$select public.set_payment_status('10000000-0000-4000-8000-0000000000c1', 'paid')$$, 'P0001', 'invalid_transition',
                 'cod: nothing is received before the delivery');
select lives_ok($$select public.set_order_status('10000000-0000-4000-8000-0000000000c1', 'delivered')$$, 'cod: delivered unpaid');
select is(pg_temp.state('10000000-0000-4000-8000-0000000000c1'), 'delivered pending', 'cod: delivered and paid are two facts');

-- the money after the delivery: collected by the carrier, then received by BOGA
select throws_ok($$select public.set_payment_status('10000000-0000-4000-8000-0000000000c1', 'paid')$$, 'P0001', 'invalid_transition',
                 'cod: received only after the carrier collected');
select throws_ok($$select public.set_payment_status('10000000-0000-4000-8000-0000000000c1', 'awaiting_verification')$$, 'P0001', 'invalid_transition',
                 'cod: no payment report to check');
select lives_ok($$select public.set_payment_status('10000000-0000-4000-8000-0000000000c1', 'collected')$$, 'cod: the carrier collected');
select throws_ok($$select public.set_payment_status('10000000-0000-4000-8000-0000000000c1', 'refunded')$$, 'P0001', 'invalid_transition',
                 'cod: no refund of money BOGA has not received');
select lives_ok($$select public.set_payment_status('10000000-0000-4000-8000-0000000000c1', 'pending')$$, 'cod: a wrong "collected" is taken back');
select lives_ok($$select public.set_payment_status('10000000-0000-4000-8000-0000000000c1', 'collected')$$, 'cod: collected again');
select is(pg_temp.state('10000000-0000-4000-8000-0000000000c1'), 'delivered collected', 'cod: the carrier holds the money, BOGA has not received it');
select lives_ok($$select public.set_payment_status('10000000-0000-4000-8000-0000000000c1', 'paid')$$, 'cod: BOGA received the money');
select is((select actor::text from public.order_events where order_id = '10000000-0000-4000-8000-0000000000c1' and label = 'payment.paid'),
          '00000000-0000-0000-0000-000000000001', 'cod: the receipt records the owner');
select throws_ok($$select public.set_payment_status('10000000-0000-4000-8000-0000000000a2', 'collected')$$, 'P0001', 'invalid_transition',
                 'Cash Plus: "collected" is for cod orders only');

-- a delivery that fails and comes back: closed, unpaid, the stock as it was
select set_config('test.stock', pg_temp.stock()::text, true);
select public.set_order_status('10000000-0000-4000-8000-0000000000c4', s) from unnest(array['confirmed', 'in_production', 'shipped']) s;
select public.record_delivery_failure('10000000-0000-4000-8000-0000000000c4', 'Refusé par le client');
select lives_ok($$select public.set_order_status('10000000-0000-4000-8000-0000000000c4', 'returned')$$, 'a failed delivery comes back');
select is((select status || '|' || payment_status || '|' || failure_reason || '|' || stock_returned from public.orders where id = '10000000-0000-4000-8000-0000000000c4'),
          'returned|pending|Refusé par le client|false', 'returned: unpaid, the reason kept, no stock given back by itself');
select is(pg_temp.stock(), current_setting('test.stock')::numeric, 'returned: the stock did not move');
select throws_ok($$select public.set_order_status('10000000-0000-4000-8000-0000000000c4', 'shipped')$$, 'P0001', 'closed', 'returned: the order is closed');
select throws_ok($$select public.set_payment_status('10000000-0000-4000-8000-0000000000c4', 'collected')$$, 'P0001', 'invalid_transition',
                 'returned: nothing to collect');

-- a cod order is cancelled before production like any unpaid order, and its stock comes back
select lives_ok($$select public.set_order_status('10000000-0000-4000-8000-0000000000c2', 'cancelled')$$, 'cod: cancelled while new');
select is(pg_temp.stock(), current_setting('test.stock')::numeric + 0.25, 'cod: the cancellation gives the stock back, as before');

select * from finish(true);
rollback;
