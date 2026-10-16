-- The catalog ready for the real data, sales closed until the owner opens them (P5 slice 12,
-- migration 20261016120000_catalog_ready): the sales gate where orders and B2B requests are written,
-- set_sales_open (owner, aal2), an origin with no price (never shown), save_origin editing the whole
-- definition but never the stock, and the delivery cap (the owner's tariff: 20 DH up to 4 kg, 30 above).
-- pgTAP, run by run-local.sh on a fresh database; the count is checked against plan().
\set ON_ERROR_STOP on
set client_min_messages = warning;
create extension if not exists pgtap;

begin;
select plan(36);

insert into auth.users values
  ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002'), ('00000000-0000-0000-0000-000000000003');
insert into public.admin_users values
  ('00000000-0000-0000-0000-000000000001', 'owner', 'Owner'),
  ('00000000-0000-0000-0000-000000000002', 'staff', 'Staff'),
  ('00000000-0000-0000-0000-000000000003', 'manager', 'Manager');
-- no salesOpen key at all: the state of the live database before the owner opens the sales
insert into public.site_config (id, settings, content) values (1, '{"b2bThresholdKg": 10}', '{}');
insert into public.origins (id, name, country_code, species, roast_level, stock_kg, low_stock_kg, price_per_kg) values
  ('brazil', '{"fr": "Brésil"}', 'BR', 'arabica', 'medium', 50, 0, 220);
insert into public.products (id, slug, kind, name, roast_level, prices, active)
values ('signature', 'signature', 'signature', '{"fr": "Signature"}', 'medium', '{"1000": 200}', true);
insert into public.product_recipes values ('signature', 'brazil', 100);
insert into public.shipping_rates (id, city, base_fee, included_kg, extra_per_kg, max_fee) values ('oujda', '{"fr": "Oujda"}', 20, 4, 10, 30);
insert into public.payment_methods (id, label) values ('card', '{"fr": "Carte"}');

create function pg_temp.token(p_sub text, p_aal text) returns text language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', p_sub, 'aal', p_aal)::text, true)
$$;
-- p_kg bags of 1 kg of Signature to Oujda, every figure right, with this delivery fee
create function pg_temp.order_of(p_kg int, p_fee numeric) returns jsonb language sql as $$
  select jsonb_build_object('locale', 'fr',
    'customer', jsonb_build_object('fullName', 'Client Test', 'phone', '+212612345678', 'cityId', 'oujda', 'address', '12 rue Test'),
    'lines', jsonb_build_array(jsonb_build_object('kind', 'product', 'productId', 'signature', 'name', '{"fr": "Signature"}', 'size', 1000, 'qty', p_kg,
      'unitPrice', 200, 'lineTotal', 200 * p_kg, 'composition', '[{"originId": "brazil", "percent": 100, "grams": 1000}]'::jsonb)),
    'weightKg', p_kg, 'subtotal', 200 * p_kg, 'shippingFee', p_fee, 'total', 200 * p_kg + p_fee, 'paymentMethod', 'card',
    'stockDeductions', jsonb_build_array(jsonb_build_object('originId', 'brazil', 'kg', p_kg)))
$$;
create function pg_temp.quote() returns jsonb language sql as $$
  select jsonb_build_object('businessType', 'cafe', 'contactName', 'Amine Test', 'phone', '+212612345678', 'cityId', 'oujda',
    'lines', '[{"kind": "product", "productId": "signature", "size": 1000, "qty": 12}]'::jsonb, 'weightKg', 12, 'indicativeTotal', 2400)
$$;
create function pg_temp.seq(p_name text) returns text language sql as $$
  select case p_name when 'order' then (select last_value || '/' || is_called from public.order_number_seq)
                     else (select last_value || '/' || is_called from public.quote_number_seq) end
$$;
create function pg_temp.mark() returns text language sql as $$ select versions ->> 'sales' from public.site_config $$;
create function pg_temp.seen_origin(p_id text) returns timestamptz language sql as $$ select updated_at from public.origins where id = p_id $$;
create function pg_temp.origin(p_id text, p_extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('id', p_id, 'name', jsonb_build_object('fr', 'TEST origine'), 'countryCode', 'ET', 'species', 'arabica',
                            'roastLevel', 'light', 'lowStockKg', 3, 'customBlendEnabled', true) || p_extra
$$;
create function pg_temp.city(p_extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('id', 'berkane', 'city', jsonb_build_object('fr', 'Berkane'), 'distanceKm', 60, 'baseFee', 20, 'includedKg', 4,
                            'extraPerKg', 10, 'maxFee', 30, 'deliveryDays', '1', 'active', true) || p_extra
$$;
create temp table seq_before as select pg_temp.seq('order') as o, pg_temp.seq('quote') as q;

-- ── the gate: closed while the setting is missing, false or anything but true ──
set local role service_role;
select throws_ok($$select * from public.commit_order(pg_temp.order_of(1, 20), '', '', '')$$, 'P0001', 'sales_closed', 'no salesOpen setting: an order is refused');
select throws_ok($$select * from public.commit_quote_request(pg_temp.quote(), '', '', '')$$, 'P0001', 'sales_closed', 'no salesOpen setting: a B2B request is refused');
reset role;
select is(pg_temp.seq('order') || ' ' || pg_temp.seq('quote'), (select o || ' ' || q from seq_before), 'a refused sale takes no order or request number');
set local role service_role;
select throws_ok($$select public.check_order(pg_temp.order_of(1, 20))$$, 'P0001', 'sales_closed', 'check_order says it too');
reset role;
update public.site_config set settings = settings || '{"salesOpen": "true"}';
set local role service_role;
select throws_ok($$select * from public.commit_order(pg_temp.order_of(1, 20), '', '', '')$$, 'P0001', 'sales_closed', 'the text "true" is not true: still closed');
reset role;
update public.site_config set settings = settings || '{"salesOpen": false}';
set local role service_role;
select throws_ok($$select * from public.commit_quote_request(pg_temp.quote(), '', '', '')$$, 'P0001', 'sales_closed', 'false: closed');
reset role;
select is((select count(*)::int from public.orders) + (select count(*)::int from public.quote_requests) + (select count(*)::int from public.notification_outbox), 0,
          'nothing was saved or queued');

-- ── set_sales_open: the owner alone, past the second factor, from the copy the page read ──
set local role anon;
select throws_ok($$select public.set_sales_open(true, null)$$, '42501', null, 'visitor: cannot even call it');
reset role;
set local role authenticated;
select pg_temp.token('00000000-0000-0000-0000-000000000002', 'aal2');
select throws_ok($$select public.set_sales_open(true, null)$$, 'P0001', 'forbidden', 'staff: refused');
select pg_temp.token('00000000-0000-0000-0000-000000000003', 'aal2');
select throws_ok($$select public.set_sales_open(true, null)$$, 'P0001', 'forbidden', 'manager: refused');
select pg_temp.token('00000000-0000-0000-0000-000000000001', 'aal1');
select throws_ok($$select public.set_sales_open(true, null)$$, 'P0001', 'forbidden', 'owner without the second factor: refused');
select pg_temp.token('00000000-0000-0000-0000-000000000001', 'aal2');
select throws_ok($$select public.set_sales_open(null, null)$$, 'P0001', 'invalid_settings', 'owner: neither open nor closed is refused');
select lives_ok($$select public.set_sales_open(true, null)$$, 'owner at aal2: opens the sales');
select throws_ok($$select public.set_sales_open(false, null)$$, 'P0001', 'stale', 'from an older copy of the page: refused');
reset role;
select is((select (settings -> 'salesOpen')::text || ' ' || (select area || '/' || item_id || '/' || actor from public.config_changes) from public.site_config),
          'true rules/salesOpen/00000000-0000-0000-0000-000000000001', 'saved as a JSON true, recorded with who did it');
select is((select settings ->> 'b2bThresholdKg' from public.site_config), '10', 'the other settings are untouched');

-- ── open: orders and requests go through; the delivery cap ──
set local role service_role;
select is((select number from public.commit_order(pg_temp.order_of(4, 20), '', '', '')), 'BC-' || to_char(now(), 'YYYY') || '-0001',
          'open: an order goes through, numbered from 1 (4 kg to Oujda: 20 DH, the 4 kg are included)');
select throws_ok($$select * from public.commit_order(pg_temp.order_of(5, 40), '', '', '')$$, 'P0001', 'invalid_order:shipping', '5 kg: not 40 DH (no cap) …');
select lives_ok($$select * from public.commit_order(pg_temp.order_of(5, 30), '', '', '')$$, '… but 30 DH, the cap');
select lives_ok($$select * from public.commit_quote_request(pg_temp.quote(), '', '', '')$$, 'open: a B2B request goes through');
reset role;

-- ── closed again: no new sale, but the orders already placed keep their life cycle ──
set local role authenticated;
select pg_temp.token('00000000-0000-0000-0000-000000000001', 'aal2');
select lives_ok(format('select public.set_sales_open(false, %L)', pg_temp.mark()), 'owner: closes the sales');
select lives_ok($$select public.set_order_status((select id from public.orders order by number limit 1), 'confirmed')$$,
                'closed: an order already placed still moves on');
reset role;
set local role service_role;
select throws_ok($$select * from public.commit_order(pg_temp.order_of(1, 20), '', '', '')$$, 'P0001', 'sales_closed', 'closed again: a new order is refused');
reset role;

-- ── an origin without a price: saved hidden, never shown; the definition edited; the stock never ──
set local role authenticated;
select pg_temp.token('00000000-0000-0000-0000-000000000003', 'aal2');
select is(public.save_origin(pg_temp.origin('test-origine'), null), 'test-origine', 'manager: creates an origin with no price');
select is((select coalesce(price_per_kg::text, 'none') || ' ' || active from public.origins where id = 'test-origine'), 'none false', 'saved hidden, with no price');
select throws_ok($$select public.save_origin(pg_temp.origin('test-origine', '{"active": true}'), pg_temp.seen_origin('test-origine'))$$,
                 'P0001', 'needs_price', 'shown without a price: refused');
select throws_ok($$select public.save_origin(pg_temp.origin('test-origine', '{"pricePerKg": "120"}'), pg_temp.seen_origin('test-origine'))$$,
                 'P0001', 'invalid_price', 'a price sent as text: refused');
select public.adjust_stock('test-origine', 5, 'restock');
select lives_ok($$select public.save_origin(pg_temp.origin('test-origine', '{"pricePerKg": 120, "active": true, "countryCode": "UG", "species": "robusta",
                                            "roastLevel": "dark", "region": "Masaka", "name": {"fr": "Ouganda", "ar": "أوغندا"}, "stockKg": 99}'),
                                            pg_temp.seen_origin('test-origine'))$$, 'manager: the whole definition, a price, shown');
select is((select (name ->> 'fr') || ' ' || country_code || ' ' || species || ' ' || roast_level || ' ' || region || ' ' || price_per_kg || ' ' || active || ' ' || stock_kg
             from public.origins where id = 'test-origine'), 'Ouganda UG robusta dark Masaka 120.00 true 5.000', 'saved; the stock stays what the history says');
select lives_ok($$select public.save_origin('{"id": "test-origine", "lowStockKg": 2}', pg_temp.seen_origin('test-origine'))$$,
                'a page that sends only some fields (an older version) …');
select is((select (name ->> 'fr') || ' ' || price_per_kg || ' ' || active || ' ' || low_stock_kg from public.origins where id = 'test-origine'),
          'Ouganda 120.00 true 2.000', '… changes only those: the rest stays as it is, the origin stays shown');
select throws_ok($$select public.save_origin(pg_temp.origin('test-origine', '{"pricePerKg": null, "active": true}'), pg_temp.seen_origin('test-origine'))$$,
                 'P0001', 'needs_price', 'the price taken away from a shown origin: refused');
reset role;
select throws_ok($$update public.origins set price_per_kg = null where id = 'test-origine'$$, '23514', null,
                 'and the table itself refuses a shown origin without a price (constraint)');

-- ── the delivery cap from the Admin Panel ──
set local role authenticated;
select pg_temp.token('00000000-0000-0000-0000-000000000003', 'aal2');
select throws_ok($$select public.save_shipping_rate(pg_temp.city('{"maxFee": 19}'), null)$$, 'P0001', 'invalid_rate', 'a cap below the base fee: refused');
select is(public.save_shipping_rate(pg_temp.city(), null), 'berkane', 'manager: a city with the owner''s tariff');
select is((select base_fee || ' ' || included_kg || ' ' || extra_per_kg || ' ' || max_fee from public.shipping_rates where id = 'berkane'), '20.00 4.000 10.00 30.00',
          'saved with its cap');
reset role;

select * from finish(true);
rollback;
