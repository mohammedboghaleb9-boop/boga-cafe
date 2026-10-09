-- Catalog writes (P5 slice 9): save_product() and save_origin() for owner and manager at
-- aal2 only, ids fixed once created, new rows hidden, stale copies refused, the API roles
-- without direct writes, and hidden rows (a product, its recipe, an origin) never read by a visitor.
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
insert into public.origins (id, name, country_code, species, roast_level, price_per_kg) values
  ('brazil', '{"fr": "Brésil"}', 'BR', 'arabica', 'medium', 220);

create function pg_temp.token(p_sub text, p_aal text) returns text language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', p_sub, 'aal', p_aal)::text, true)
$$;
-- a product as the panel sends it, and its version as the page read it
create function pg_temp.product(p_id text, p_extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('id', p_id, 'kind', 'signature', 'roastLevel', 'medium', 'name', jsonb_build_object('fr', 'TEST produit'),
                            'prices', jsonb_build_object('250', 60), 'active', true, 'sortOrder', 9) || p_extra
$$;
create function pg_temp.recipe(p_percent int default 100) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('originId', 'brazil', 'percent', p_percent))
$$;
create function pg_temp.seen_product(p_id text) returns timestamptz language sql as $$ select updated_at from public.products where id = p_id $$;
create function pg_temp.seen_origin(p_id text) returns timestamptz language sql as $$ select updated_at from public.origins where id = p_id $$;
create function pg_temp.origin(p_id text, p_extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('id', p_id, 'name', jsonb_build_object('fr', 'TEST origine'), 'countryCode', 'ET', 'species', 'arabica',
                            'roastLevel', 'light', 'pricePerKg', 100, 'lowStockKg', 3, 'customBlendEnabled', true, 'active', true) || p_extra
$$;
set local role authenticated;

-- who may save: owner and manager past the second factor; never staff
select pg_temp.token('00000000-0000-0000-0000-000000000001', 'aal1');
select throws_ok($$select public.save_product(pg_temp.product('test-produit'), pg_temp.recipe(), null)$$, 'P0001', 'forbidden', 'owner at aal1: save_product refused');
select pg_temp.token('00000000-0000-0000-0000-000000000002', 'aal2');
select throws_ok($$select public.save_product(pg_temp.product('test-produit'), pg_temp.recipe(), null)$$, 'P0001', 'forbidden', 'staff: save_product refused');
select throws_ok($$select public.save_origin(pg_temp.origin('test-origine'), null)$$, 'P0001', 'forbidden', 'staff: save_origin refused');

-- a new product: created hidden, whatever is asked, with who made it
select pg_temp.token('00000000-0000-0000-0000-000000000003', 'aal2');
select is(public.save_product(pg_temp.product('test-produit'), pg_temp.recipe(), null), 'test-produit', 'manager: creates a product, its id comes back');
select is((select active::text || ' ' || slug || ' ' || (select actor::text || ' ' || action from public.catalog_changes where item_id = 'test-produit')
             from public.products where id = 'test-produit'),
          'false test-produit 00000000-0000-0000-0000-000000000003 create', 'a new product is created hidden, its address is its id, with who made it');
select throws_ok($$select public.save_product(pg_temp.product('test-produit'), pg_temp.recipe(), null)$$, 'P0001', 'exists', 'a second product with the same id is refused, never replaced');

-- an edit from the copy the page read; an older copy is refused
create temp table seen as select pg_temp.seen_product('test-produit') as at;
grant select on seen to authenticated;
select lives_ok($$select public.save_product(pg_temp.product('test-produit', '{"prices": {"250": 65, "500": 120}}'), pg_temp.recipe(), (select at from seen))$$,
                'manager: edits the product from the copy the page read');
select is((select (prices ->> '500') || ' ' || active::text from public.products where id = 'test-produit'), '120 true', 'the edit is saved, and may show the product');
select throws_ok($$select public.save_product(pg_temp.product('test-produit'), pg_temp.recipe(), (select at from seen))$$, 'P0001', 'stale',
                 'an edit from an older copy is refused, never written over the newer one');

-- the id is fixed after creation
select throws_ok($$select public.save_product(pg_temp.product('test-produit', '{"slug": "other-address"}'), pg_temp.recipe(), pg_temp.seen_product('test-produit'))$$,
                 'P0001', 'id_fixed', 'an edit cannot change the address');
select throws_ok($$select public.save_product(pg_temp.product('renamed-produit'), pg_temp.recipe(), pg_temp.seen_product('test-produit'))$$,
                 'P0001', 'not_found', 'an edit under another id renames nothing');
select is((select count(*)::int from public.products), 1, 'still one product, under its first id');

-- what the save checks
select throws_ok($$select public.save_product(pg_temp.product('test-2'), pg_temp.recipe(99), null)$$, 'P0001', 'invalid_recipe', 'a recipe adding up to 99 % is refused');
select throws_ok($$select public.save_product(pg_temp.product('test-2', '{"prices": {"250": 0}}'), pg_temp.recipe(), null)$$, 'P0001', 'invalid_price', 'a price of 0 is refused');
select throws_ok($$select public.save_product(pg_temp.product('test-produit', '{"prices": {}}'), pg_temp.recipe(), pg_temp.seen_product('test-produit'))$$,
                 'P0001', 'needs_price', 'a shown product needs at least one price');
select throws_ok($$select public.save_product(pg_temp.product('Test Produit'), pg_temp.recipe(), null)$$, 'P0001', 'invalid_id', 'an id that is not an address is refused');
select throws_ok($$select public.save_product(pg_temp.product('new'), pg_temp.recipe(), null)$$, 'P0001', 'invalid_id', '"new" (the add-product address) is refused');
select throws_ok($$select public.save_product(pg_temp.product('test-2', '{"name": {"fr": " "}}'), pg_temp.recipe(), null)$$, 'P0001', 'invalid_text', 'a product needs a French name');

-- origins: created hidden at 0 kg; afterwards price, alert level and Custom Blend only
select is(public.save_origin(pg_temp.origin('test-origine'), null), 'test-origine', 'manager: creates an origin');
select is((select active::text || ' ' || stock_kg::text from public.origins where id = 'test-origine'), 'false 0.000', 'a new origin is created hidden, at 0 kg');
select lives_ok($$select public.save_origin(pg_temp.origin('test-origine', '{"pricePerKg": 120, "lowStockKg": 2, "customBlendEnabled": false, "active": true, "name": {"fr": "Renamed"}}'),
                                            pg_temp.seen_origin('test-origine'))$$, 'manager: edits an origin');
select is((select price_per_kg || ' ' || low_stock_kg || ' ' || custom_blend_enabled || ' ' || active || ' ' || (name ->> 'fr') from public.origins where id = 'test-origine'),
          '120.00 2.000 false false TEST origine', 'only the price, the alert level and Custom Blend change: never shown, never renamed');
select throws_ok($$select public.save_origin(pg_temp.origin('test-origine'), '2026-01-01')$$, 'P0001', 'stale', 'an origin edit from an older copy is refused');
select throws_ok($$select public.save_origin(pg_temp.origin('other-origine'), pg_temp.seen_origin('test-origine'))$$, 'P0001', 'not_found', 'an origin edit under another id renames nothing');
select is((select string_agg(item || ' ' || item_id || ' ' || action || ' ' || actor, ', ' order by id) from public.catalog_changes),
          'product test-produit create 00000000-0000-0000-0000-000000000003, product test-produit edit 00000000-0000-0000-0000-000000000003, '
          'origin test-origine create 00000000-0000-0000-0000-000000000003, origin test-origine edit 00000000-0000-0000-0000-000000000003',
          'each save is recorded once, with who did it; a refused one leaves no line');

-- an order or a stock line in between does not make the page's copy old: the version follows the details only
create temp table seen_o as select pg_temp.seen_origin('test-origine') as at;
select public.adjust_stock('test-origine', 5, 'restock');
select lives_ok($$select public.save_origin(pg_temp.origin('test-origine', '{"pricePerKg": 130}'), (select at from seen_o))$$,
                'a stock change since the page read the origin does not refuse its save');
select throws_ok($$select public.save_product(pg_temp.product('test-produit', '{"prices": {"250": 100001}}'), pg_temp.recipe(), pg_temp.seen_product('test-produit'))$$,
                 'P0001', 'invalid_price', 'a price above 100 000 DH is refused');
select throws_ok($$select public.save_product(pg_temp.product('test-produit'), '[{"originId": "test-origine", "percent": 100}]', pg_temp.seen_product('test-produit'))$$,
                 'P0001', 'hidden_origin', 'a shown product is made of shown origins only');

-- no role writes the catalog directly through the API
select pg_temp.token('00000000-0000-0000-0000-000000000001', 'aal2');
select throws_ok($$update public.products set active = true$$, '42501', null, 'owner: a product cannot be changed directly');
select throws_ok($$delete from public.product_recipes$$, '42501', null, 'owner: a recipe cannot be deleted directly');
select throws_ok($$insert into public.origins (id, name, country_code, species, roast_level, price_per_kg) values ('x', '{}', 'XX', 'arabica', 'light', 1)$$,
                 '42501', null, 'owner: an origin cannot be inserted directly');

-- hidden stays hidden: a visitor never reads a hidden product, its recipe or a hidden origin
select lives_ok($$select public.save_product(pg_temp.product('test-produit', '{"active": false}'), pg_temp.recipe(), pg_temp.seen_product('test-produit'))$$, 'owner: hides the product');
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
select is((select count(*)::int from public.products where id = 'test-produit'), 0, 'visitor: a hidden product is not read');
select is((select count(*)::int from public.product_recipes where product_id = 'test-produit') + (select count(*)::int from public.origins where id = 'test-origine'), 0,
          'visitor: neither its recipe nor a hidden origin is read');
select throws_ok($$select count(*) from public.catalog_changes$$, '42501', null, 'visitor: who changed the catalog is not read');

-- every function of the schema keeps a fixed search_path (this migration replaces touch_updated_at)
reset role;
select is((select string_agg(p.proname, ', ') from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
              and not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')), null,
          'every function keeps a fixed search_path');

select * from finish(true);
rollback;
