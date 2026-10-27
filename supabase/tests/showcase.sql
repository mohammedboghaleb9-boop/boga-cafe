-- The catalog shown without prices (migration 20261021120000_catalog_showcase, owner 2026-10-21): `listed` rows read
-- by visitors through showcase_catalog() only, with the display fields and nothing of a price, a stock or a date;
-- nobody may list a row from the site; a listed row is never for sale (orders and B2B requests are refused, sales
-- closed or open). pgTAP, run by run-local.sh on a fresh database; the count is checked against plan().
\set ON_ERROR_STOP on
set client_min_messages = warning;
create extension if not exists pgtap;

begin;
select plan(40);

insert into auth.users values ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000003');
insert into public.admin_users values
  ('00000000-0000-0000-0000-000000000001', 'owner', 'Owner'),
  ('00000000-0000-0000-0000-000000000003', 'manager', 'Manager');
-- no salesOpen key at all: the live database while the sales are closed
insert into public.site_config (id, settings, content) values (1, '{"b2bThresholdKg": 10}', '{}');
-- hidden from sale (no price), as on live; uganda is not listed
insert into public.origins (id, name, country_code, species, roast_level, stock_kg, low_stock_kg, price_per_kg, restock_date, active) values
  ('brazil', '{"fr": "Brésil"}', 'BR', 'arabica', 'medium', 40, 7, null, '2026-11-12', false),
  ('vietnam', '{"fr": "Viêt Nam"}', 'VN', 'robusta', 'medium-dark', 0, 5, null, null, false),
  ('uganda', '{"fr": "Ouganda"}', 'UG', 'robusta', 'dark', 0, 5, null, null, false),
  -- for sale, with a price: readable by visitors only once the sales are open
  ('colombia', '{"fr": "Colombie"}', 'CO', 'arabica', 'medium', 30, 5, 220, null, true);
-- a stored price on a hidden product: it must never reach a visitor
insert into public.products (id, slug, kind, name, roast_level, prices, active, sort_order) values
  ('shown', 'shown', 'signature', '{"fr": "Montré"}', 'medium', '{"1000": 200}', false, 2),
  ('mixed', 'mixed', 'signature', '{"fr": "Mélange"}', 'medium', '{}', false, 1),
  ('hidden', 'hidden', 'signature', '{"fr": "Caché"}', 'medium', '{}', false, 3),
  ('onsale', 'onsale', 'single-origin', '{"fr": "En vente"}', 'medium', '{"1000": 250}', true, 4);
insert into public.product_recipes values ('shown', 'brazil', 70), ('shown', 'vietnam', 30), ('mixed', 'brazil', 50), ('mixed', 'uganda', 50), ('hidden', 'brazil', 100), ('onsale', 'colombia', 100);
insert into public.shipping_rates (id, city, base_fee, included_kg, extra_per_kg, active) values ('oujda', '{"fr": "Oujda"}', 20, 3, 10, true);
insert into public.payment_methods (id, label) values ('card', '{"fr": "Carte"}');

create function pg_temp.token(p_sub text, p_aal text) returns text language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', p_sub, 'aal', p_aal)::text, true)
$$;
create function pg_temp.order_of() returns jsonb language sql as $$
  select jsonb_build_object('locale', 'fr',
    'customer', jsonb_build_object('fullName', 'Client Test', 'phone', '+212612345678', 'cityId', 'oujda', 'address', '12 rue Test'),
    'lines', jsonb_build_array(jsonb_build_object('kind', 'product', 'productId', 'shown', 'name', '{"fr": "Montré"}', 'size', 1000, 'qty', 1,
      'unitPrice', 200, 'lineTotal', 200, 'composition', '[{"originId": "brazil", "percent": 70, "grams": 700}, {"originId": "vietnam", "percent": 30, "grams": 300}]'::jsonb)),
    'weightKg', 1, 'subtotal', 200, 'shippingFee', 20, 'total', 220, 'paymentMethod', 'card',
    'stockDeductions', '[{"originId": "brazil", "kg": 0.7}, {"originId": "vietnam", "kg": 0.3}]'::jsonb)
$$;
create function pg_temp.quote() returns jsonb language sql as $$
  select jsonb_build_object('businessType', 'cafe', 'contactName', 'Amine Test', 'phone', '+212612345678', 'cityId', 'oujda',
    'lines', '[{"kind": "product", "productId": "shown", "size": 1000, "qty": 12}]'::jsonb, 'weightKg', 12, 'indicativeTotal', 2400)
$$;
create function pg_temp.keys(p jsonb) returns text[] language sql as $$ select array_agg(k order by k) from jsonb_object_keys(p) k $$;

-- ── the flag: a column of its own, false unless set ──
select col_not_null('public', 'products', 'listed', 'products.listed is never null');
select col_default_is('public', 'products', 'listed', 'false', 'a new product starts unlisted');
select col_not_null('public', 'origins', 'listed', 'origins.listed is never null');
select col_default_is('public', 'origins', 'listed', 'false', 'a new origin starts unlisted');
update public.products set listed = true where id in ('shown', 'mixed');
update public.origins set listed = true where id in ('brazil', 'vietnam');

-- ── the public read: definer, fixed path, run by visitors, not by PUBLIC ──
select is((select prosecdef from pg_proc where oid = 'public.showcase_catalog()'::regprocedure), true, 'showcase_catalog runs as its owner');
select ok((select proconfig @> array['search_path=public, pg_temp'] from pg_proc where oid = 'public.showcase_catalog()'::regprocedure), 'its search_path is fixed');
select ok(has_function_privilege('anon', 'public.showcase_catalog()', 'execute') and has_function_privilege('authenticated', 'public.showcase_catalog()', 'execute'),
  'visitors and signed-in users may run it');
select ok(not exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = 'public.showcase_catalog()'::regprocedure and a.grantee = 0),
  'PUBLIC may not (only the roles granted)');
select ok((select prosecdef and proconfig @> array['search_path=public, pg_temp'] from pg_proc where oid = 'public.sales_open()'::regprocedure)
      and not exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = 'public.sales_open()'::regprocedure and a.grantee = 0),
  'sales_open() too: its owner, a fixed path, not PUBLIC');

-- ── what a visitor reads ──
set local role anon;
create temp table shown as select public.showcase_catalog() as j;
reset role;
select is((select array_agg(x ->> 'id' order by x ->> 'id') from shown, jsonb_array_elements(j -> 'products') x), array['shown'],
  'listed products only, and only those whose every origin is listed (mixed uses uganda; hidden is not listed)');
select is((select array_agg(x ->> 'id' order by x ->> 'id') from shown, jsonb_array_elements(j -> 'origins') x), array['brazil', 'vietnam'], 'listed origins only');
select is((select pg_temp.keys(j -> 'products' -> 0) from shown),
  array['description', 'featured', 'id', 'image_url', 'kind', 'name', 'recipe', 'roast_level', 'slug', 'sort_order', 'tagline', 'tasting_notes'],
  'a product: its display fields, nothing else');
select is((select pg_temp.keys(j -> 'origins' -> 0) from shown),
  array['country_code', 'custom_blend_enabled', 'id', 'name', 'region', 'roast_level', 'species', 'tasting_notes'], 'an origin: its display fields, nothing else');
select is((select j -> 'products' -> 0 -> 'recipe' from shown), '[{"percent": 70, "origin_id": "brazil"}, {"percent": 30, "origin_id": "vietnam"}]'::jsonb,
  'the recipe comes with the product');
select ok((select j::text !~ '"(prices|price_per_kg|stock_kg|low_stock_kg|restock_date|active|updated_at|listed)"' and j::text !~ '(200|2026-11-12)' from shown),
  'no price, stock, low-stock level, restock date, sale switch or change time anywhere in the answer (the stored 200 DH and the date stay inside)');
set local role anon;
select is((select count(*)::int from public.products) + (select count(*)::int from public.origins), 0,
  'sales closed: the tables show visitors nothing, not even a row for sale (no price, stock or date leaves the database)');
reset role;
select pg_temp.token('00000000-0000-0000-0000-000000000003', 'aal2');
set local role authenticated;
select is((select count(*)::int from public.products) || '/' || (select count(*)::int from public.origins), '4/4', 'an admin still reads every row');
reset role;
select set_config('request.jwt.claims', '', true);

-- ── nobody lists a row from the site: no write on the tables, the panel's saves keep the flag ──
set local role anon;
select throws_ok($$update public.products set listed = true where id = 'hidden'$$, '42501', null, 'a visitor cannot list a product');
reset role;
select pg_temp.token('00000000-0000-0000-0000-000000000001', 'aal2');
set local role authenticated;
select throws_ok($$update public.products set listed = true where id = 'hidden'$$, '42501', null, 'the owner cannot list a product by writing the table either');
select throws_ok($$update public.origins set listed = true where id = 'uganda'$$, '42501', null, 'nor an origin');
select is(public.save_product(jsonb_build_object('id', 'new-one', 'kind', 'signature', 'roastLevel', 'medium', 'name', '{"fr": "Nouveau"}'::jsonb, 'prices', '{}'::jsonb, 'active', false, 'sortOrder', 9),
  '[{"originId": "brazil", "percent": 100}]', null), 'new-one', 'the owner creates a product from the panel …');
select is((select listed from public.products where id = 'new-one'), false, '… and it starts unlisted');
select lives_ok($$select public.save_product(jsonb_build_object('id', 'shown', 'kind', 'signature', 'roastLevel', 'dark', 'name', '{"fr": "Montré"}'::jsonb, 'prices', '{}'::jsonb, 'active', false, 'sortOrder', 2),
  '[{"originId": "brazil", "percent": 70}, {"originId": "vietnam", "percent": 30}]', (select updated_at from public.products where id = 'shown'))$$, 'editing a listed product …');
select is((select listed from public.products where id = 'shown'), true, '… keeps it listed (the save has no say on the flag)');
reset role;
select pg_temp.token('00000000-0000-0000-0000-000000000003', 'aal2');
set local role authenticated;
select throws_ok($$update public.products set listed = false where id = 'shown'$$, '42501', null, 'the manager gets no new right: no write on the flag');
reset role;

-- ── a listed row is never for sale ──
set local role service_role;
select throws_ok($$select * from public.commit_order(pg_temp.order_of(), '', '', '')$$, 'P0001', 'sales_closed', 'sales closed: an order of a listed product is refused');
select throws_ok($$select * from public.commit_quote_request(pg_temp.quote(), '', '', '')$$, 'P0001', 'sales_closed', 'sales closed: a B2B request is refused');
reset role;
-- the owner opens the sales (the settings guard checks who writes)
select pg_temp.token('00000000-0000-0000-0000-000000000001', 'aal2');
update public.site_config set settings = settings || '{"salesOpen": true}';
set local role service_role;
select throws_ok($$select * from public.commit_order(pg_temp.order_of(), '', '', '')$$, 'P0001', 'invalid_order:product', 'sales open: a listed product is still not for sale');
select throws_ok($$select public.check_order(pg_temp.order_of())$$, 'P0001', 'invalid_order:product', 'check_order says so too');
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
select is((select string_agg(id, ',' order by id) from public.products) || ' ' || (select string_agg(id, ',' order by id) from public.origins), 'onsale colombia',
  'sales open: visitors read the rows for sale, and only those (listed rows stay out)');
reset role;
-- a B2B request reaches the database only through the storefront function (service_role), which drops a line that is
-- not for sale (src/core/requests.ts; src/server/__tests__/storefront.test.ts): visitors cannot call it themselves. The
-- database function refuses a product that is not for sale itself once the sales are open (migration
-- 20261027090000_quote_lines_for_sale, R20): checked below.
select ok(not has_function_privilege('anon', 'public.commit_quote_request(jsonb, text, text, text)', 'execute')
      and not has_function_privilege('authenticated', 'public.commit_quote_request(jsonb, text, text, text)', 'execute')
      and not has_function_privilege('anon', 'public.commit_order(jsonb, text, text, text, uuid)', 'execute'),
  'visitors and signed-in users cannot write an order or a B2B request themselves');
select is((select count(*)::int from public.orders) + (select count(*)::int from public.notification_outbox), 0,
  'nothing was written: no order, no message');
-- ── R20: a B2B request names only products for sale (the sales are open here) ──
create function pg_temp.quote_of(p_lines jsonb) returns jsonb language sql as $$
  select pg_temp.quote() || jsonb_build_object('lines', p_lines)
$$;
set local role service_role;
select throws_ok($$select * from public.commit_quote_request(pg_temp.quote(), '', '', '')$$, 'P0001', 'invalid_quote:product', 'a listed-only product is refused');
select throws_ok($$select * from public.commit_quote_request(pg_temp.quote_of('[{"kind": "product", "productId": "hidden", "size": 1000, "qty": 12}]'), '', '', '')$$,
  'P0001', 'invalid_quote:product', 'a hidden product is refused');
select throws_ok($$select * from public.commit_quote_request(pg_temp.quote_of('[{"kind": "product", "productId": "ghost", "size": 1000, "qty": 12}]'), '', '', '')$$,
  'P0001', 'invalid_quote:product', 'an unknown product is refused');
select throws_ok($$select * from public.commit_quote_request(pg_temp.quote_of('[{"kind": "product", "productId": "onsale", "size": 1000, "qty": 12}, {"kind": "product", "productId": "hidden", "size": 1000, "qty": 1}]'), '', '', '')$$,
  'P0001', 'invalid_quote:product', 'one line not for sale refuses the whole request');
select throws_ok($$select * from public.commit_quote_request(pg_temp.quote_of('["onsale"]'), '', '', '')$$, 'P0001', 'invalid_quote:lines', 'a line that is not an object is refused');
select lives_ok($$select * from public.commit_quote_request(pg_temp.quote_of('[{"kind": "product", "productId": "onsale", "size": 1000, "qty": 12}]'), '', '', '')$$,
  'a product for sale is accepted');
reset role;
select is((select count(*)::int from public.quote_requests), 1, 'only the request for a product for sale was written');
update public.site_config set settings = settings - 'salesOpen';

-- ── nothing listed: an empty answer, not an error ──
update public.products set listed = false;
update public.origins set listed = false;
set local role anon;
select is(public.showcase_catalog(), '{"origins": [], "products": []}'::jsonb, 'nothing listed: empty lists');
reset role;

select * from finish(true);
rollback;
