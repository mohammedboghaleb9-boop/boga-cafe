-- Product and origin texts without the spaces at their start and end (P5 slice 11, migration
-- 20261013100000_catalog_trim) AND the behaviour that must not change: a key that is not sent
-- stays not sent, so its default still applies. SQL NULL (a missing key) and JSON null (a key
-- written back with jsonb_build_object) are not the same thing: the default only replaces SQL NULL.
-- pgTAP, run by run-local.sh on a fresh database; the count is checked against plan().
\set ON_ERROR_STOP on
set client_min_messages = warning;
create extension if not exists pgtap;

begin;
select plan(42);

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
-- a product as the panel sends it: only name and prices among the texts and numbers, the optional texts are not sent
create function pg_temp.product(p_id text, p_extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('id', p_id, 'kind', 'signature', 'roastLevel', 'medium', 'name', jsonb_build_object('fr', 'TEST produit'),
                            'prices', jsonb_build_object('250', 60), 'active', false, 'sortOrder', 9) || p_extra
$$;
create function pg_temp.recipe() returns jsonb language sql as $$ select jsonb_build_array(jsonb_build_object('originId', 'brazil', 'percent', 100)) $$;
create function pg_temp.origin(p_id text, p_extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('id', p_id, 'name', jsonb_build_object('fr', 'TEST origine'), 'countryCode', 'ET', 'species', 'arabica',
                            'roastLevel', 'light', 'pricePerKg', 100, 'lowStockKg', 3, 'customBlendEnabled', true) || p_extra
$$;
create function pg_temp.text(p_fr text, p_ar text default '') returns jsonb language sql as $$ select jsonb_build_object('ar', p_ar, 'fr', p_fr, 'en', '') $$;
create function pg_temp.seen_product(p_id text) returns timestamptz language sql as $$ select updated_at from public.products where id = p_id $$;
create function pg_temp.seen_origin(p_id text) returns timestamptz language sql as $$ select updated_at from public.origins where id = p_id $$;

-- the helper, as the tables' owner (no API role runs it)
select is(public.config_trim_keys('{"name": {"fr": " x "}, "region": " Oujda\n", "id": " keep "}', array['name'], array['region']),
          '{"name": {"fr": "x"}, "region": "Oujda", "id": " keep "}'::jsonb, 'the listed keys are trimmed, every other key is left as it is');
select is(public.config_trim_keys('{"name": {"fr": "x"}}', array['name', 'tagline', 'description'], array['region']), '{"name": {"fr": "x"}}'::jsonb,
          'a key that is not sent is not added: nothing becomes null');
select is((public.config_trim_keys('{"tagline": null}', array['tagline'], '{}') -> 'tagline') is null,
          false, 'a JSON null that was sent stays a JSON null: not an SQL NULL');
select is(jsonb_typeof(public.config_trim_keys('{"tagline": null}', array['tagline'], '{}') -> 'tagline'), 'null', 'and it is still the JSON null it was');
select is((('{"name": {"fr": "x"}}'::jsonb) -> 'tagline') is null, true, 'a missing key reads as an SQL NULL: that is what the defaults of save_product replace');
-- the trap this avoids: rebuilding the object with jsonb_build_object turns a missing key into a JSON null
select is(jsonb_typeof(jsonb_build_object('tagline', ('{}'::jsonb) -> 'tagline') -> 'tagline'), 'null',
          'jsonb_build_object of an SQL NULL gives a JSON null, not a missing key');
select is(coalesce(jsonb_build_object('tagline', ('{}'::jsonb) -> 'tagline') -> 'tagline', '{}'::jsonb), 'null'::jsonb,
          'so a coalesce default would no longer apply after such a rebuild...');
select is(coalesce(public.config_trim_keys('{}'::jsonb, array['tagline'], '{}') -> 'tagline', '{}'::jsonb), '{}'::jsonb,
          '...while after config_trim_keys the default still applies');
select is(public.config_trim_keys('[1]'::jsonb, array['name'], '{}'), '[1]'::jsonb, 'an array comes back as it is');
select is(public.config_trim_keys(null::jsonb, array['name'], '{}') is null, true, 'an SQL NULL comes back as NULL');
select is(public.config_trim_keys('{"region": 5, "name": "x"}', array['name'], array['region']), '{"region": 5, "name": "x"}'::jsonb,
          'a value of another type is left for the checks to refuse');
select is(has_function_privilege('anon', 'public.config_trim_keys(jsonb, text[], text[])', 'execute')
          or has_function_privilege('authenticated', 'public.config_trim_keys(jsonb, text[], text[])', 'execute'), false, 'no API role can run the helper');

set local role authenticated;
select pg_temp.token('00000000-0000-0000-0000-000000000003', 'aal2');

-- a product: its texts trimmed, inside a text nothing changes
select is(public.save_product(pg_temp.product('test-produit', jsonb_build_object(
    'name', pg_temp.text(E'  TEST produit \t', E' اختبار '), 'tagline', pg_temp.text(' Court '),
    'description', pg_temp.text(E'\nLigne 1\n\n  Ligne 2 '), 'tastingNotes', pg_temp.text(' Cacao '))), pg_temp.recipe(), null), 'test-produit',
          'manager: creates a product whose texts have spaces and line breaks around them');
select is((select (name ->> 'fr') || '|' || (name ->> 'ar') || '|' || (tagline ->> 'fr') || '|' || (tasting_notes ->> 'fr') from public.products where id = 'test-produit'),
          E'TEST produit|اختبار|Court|Cacao', 'name, tagline and tasting notes are kept without them, in every language');
select is((select description ->> 'fr' from public.products where id = 'test-produit'), E'Ligne 1\n\n  Ligne 2', 'inside a text the line breaks and the spaces stay');

-- what was already true and must stay true: a text that is not sent gets its default, a JSON null is refused
select is(public.save_product(pg_temp.product('test-2'), pg_temp.recipe(), null), 'test-2', 'a product with no optional text at all is still saved');
select is((select tagline::text || description::text || tasting_notes::text from public.products where id = 'test-2'), '{}{}{}', 'each optional text that was not sent is saved as the empty object, as before');
select throws_ok($$select public.save_product(pg_temp.product('test-3', '{"tagline": null}'), pg_temp.recipe(), null)$$, 'P0001', 'invalid_text',
                 'a tagline sent as a JSON null is still refused: only a missing one gets the default');
select throws_ok($$select public.save_product(pg_temp.product('test-3') - 'name', pg_temp.recipe(), null)$$, 'P0001', 'invalid_text', 'a missing name is still refused');
select throws_ok($$select public.save_product(pg_temp.product('test-3', jsonb_build_object('name', pg_temp.text('  '))), pg_temp.recipe(), null)$$,
                 'P0001', 'invalid_text', 'a name of spaces only is no name');
select lives_ok($$select public.save_product(pg_temp.product('test-3', jsonb_build_object('name', pg_temp.text(repeat(' ', 9) || repeat('x', 80) || E'\n'))), pg_temp.recipe(), null)$$,
                'a limit counts what is kept: 80 characters between spaces are saved');
select throws_ok($$select public.save_product(pg_temp.product('test-4', jsonb_build_object('name', pg_temp.text(repeat(' ', 9) || repeat('x', 81)))), pg_temp.recipe(), null)$$,
                 'P0001', 'invalid_text', '81 characters are still refused');
select throws_ok($$select public.save_product(pg_temp.product('test-4', '{"kind": " signature"}'), pg_temp.recipe(), null)$$, 'P0001', 'invalid_kind', 'the fixed values stay strict: a kind with a space is refused');
select throws_ok($$select public.save_product(pg_temp.product(' test-4'), pg_temp.recipe(), null)$$, 'P0001', 'invalid_id', 'an id with a space is refused, never trimmed');
select throws_ok($$select public.save_product(null::jsonb, pg_temp.recipe(), null)$$, 'P0001', 'invalid_id', 'no product at all is refused cleanly');

-- an edit: the texts are trimmed too, the recipe is replaced whole, an older copy is still refused
select lives_ok($$select public.save_product(pg_temp.product('test-produit', jsonb_build_object('name', pg_temp.text(' Renomme '))), pg_temp.recipe(), pg_temp.seen_product('test-produit'))$$,
                'manager: edits a product whose name has spaces around it');
select is((select (name ->> 'fr') || ' ' || (select count(*)::text || '/' || sum(percent)::text from public.product_recipes where product_id = 'test-produit')
             from public.products where id = 'test-produit'), 'Renomme 1/100', 'the edit is kept trimmed and the recipe is still replaced whole');
select throws_ok($$select public.save_product(pg_temp.product('test-produit'), pg_temp.recipe(), '2026-01-01')$$, 'P0001', 'stale', 'an older copy is still refused');

-- an origin
select is(public.save_origin(pg_temp.origin('test-origine', jsonb_build_object('name', pg_temp.text(E' TEST origine\n'), 'tastingNotes', pg_temp.text(' Fruite '), 'region', E'  Sidamo \t')), null),
          'test-origine', 'manager: creates an origin whose texts have spaces and line breaks around them');
select is((select (name ->> 'fr') || '|' || (tasting_notes ->> 'fr') || '|' || region || '|' || active::text || '|' || stock_kg::text from public.origins where id = 'test-origine'),
          'TEST origine|Fruite|Sidamo|false|0.000', 'they are kept without them, and the origin is still created hidden at 0 kg');
select is(public.save_origin(pg_temp.origin('test-o2'), null), 'test-o2', 'an origin with no optional text is still saved');
select is((select tasting_notes::text || '/' || region from public.origins where id = 'test-o2'), '{}/', 'a tasting note or a region that was not sent gets its default, as before');
select is(public.save_origin(pg_temp.origin('test-o3', '{"region": null}'), null), 'test-o3', 'a region sent as a JSON null is still saved: ->> reads it as an SQL NULL, which the default replaces');
select is((select region from public.origins where id = 'test-o3'), '', 'and it is saved empty, as before');
select throws_ok($$select public.save_origin(pg_temp.origin('test-o4', '{"tastingNotes": null}'), null)$$, 'P0001', 'invalid_origin', 'tasting notes sent as a JSON null are still refused');
select throws_ok($$select public.save_origin(pg_temp.origin('test-o4', jsonb_build_object('name', pg_temp.text('   '))), null)$$, 'P0001', 'invalid_origin', 'an origin name of spaces only is no name');
select lives_ok($$select public.save_origin(pg_temp.origin('test-o5', jsonb_build_object('region', repeat(' ', 5) || repeat('r', 80) || ' ')), null)$$, 'a region of 80 characters between spaces is saved');
select throws_ok($$select public.save_origin(pg_temp.origin('test-o6', jsonb_build_object('region', repeat('r', 81))), null)$$, 'P0001', 'invalid_origin', 'a region of 81 characters is still refused');
select is(public.save_origin(pg_temp.origin('test-origine', jsonb_build_object('name', pg_temp.text(' Autre '), 'pricePerKg', 120)), pg_temp.seen_origin('test-origine')),
          'test-origine', 'manager: edits an origin from the copy the page read');
select is((select (name ->> 'fr') || ' ' || price_per_kg::text from public.origins where id = 'test-origine'), 'TEST origine 120.00', 'an edit still changes the price only, never the name');

-- who may save, and nothing at all
select pg_temp.token('00000000-0000-0000-0000-000000000002', 'aal2');
select throws_ok($$select public.save_origin(pg_temp.origin('test-o7'), null)$$, 'P0001', 'forbidden', 'staff: still refused');
select pg_temp.token('00000000-0000-0000-0000-000000000001', 'aal2');
select throws_ok($$select public.save_origin(null::jsonb, null)$$, 'P0001', 'invalid_id', 'no origin at all is refused cleanly');

reset role;
select * from finish(true);
rollback;
