-- Admin rights need the second factor (P5 slice 6, migration 20261008205033_admin_aal2):
-- an admin_users member at aal1 reads and writes like a visitor; at aal2 it is an admin.
-- pgTAP, run by run-local.sh on a fresh database; finish(true) fails the run on any "not ok".
\set ON_ERROR_STOP on
set client_min_messages = warning;
create extension if not exists pgtap;

begin;
select plan(16);

insert into auth.users values
  ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002'), ('00000000-0000-0000-0000-000000000009');
insert into public.admin_users values
  ('00000000-0000-0000-0000-000000000001', 'owner', 'Owner'),
  ('00000000-0000-0000-0000-000000000002', 'staff', 'Staff');
insert into public.origins (id, name, country_code, species, roast_level, price_per_kg, active) values
  ('brazil', '{"fr": "Brésil"}', 'BR', 'arabica', 'medium', 220, true),
  ('hidden', '{"fr": "Caché"}',  'ET', 'arabica', 'light',  300, false);

-- the signed-in user's token, as the API sets it for the request
create function pg_temp.token(p_sub text, p_aal text) returns text language sql as $$
  select set_config('request.jwt.claims',
    jsonb_strip_nulls(jsonb_build_object('sub', p_sub, 'aal', p_aal))::text, true)
$$;
set local role authenticated;

-- the rule itself
select pg_temp.token('00000000-0000-0000-0000-000000000001', 'aal2');
select is(public.is_admin(), true, 'owner at aal2: admin');
select is(public.is_admin(array['owner']), true, 'owner at aal2: owner rights');
select pg_temp.token('00000000-0000-0000-0000-000000000001', 'aal1');
select is(public.is_admin(), false, 'owner at aal1 (password only): not an admin');
select is(public.is_admin(array['owner']), false, 'owner at aal1: no owner rights');
select pg_temp.token('00000000-0000-0000-0000-000000000001', null);
select is(public.is_admin(), false, 'owner, token without aal (= aal1): not an admin');
select pg_temp.token('00000000-0000-0000-0000-000000000002', 'aal2');
select is(public.is_admin(array['owner']), false, 'staff at aal2: still no owner rights (roles unchanged)');
select pg_temp.token('00000000-0000-0000-0000-000000000009', 'aal2');
select is(public.is_admin(), false, 'account with no admin_users row, at aal2: not an admin');

-- what the policies and functions built on is_admin() let through
select pg_temp.token('00000000-0000-0000-0000-000000000001', 'aal1');
select is((select count(*)::int from public.origins), 1, 'owner at aal1: sees the active catalog only, like a visitor');
select is((select role from public.admin_users where user_id = '00000000-0000-0000-0000-000000000001'), 'owner', 'owner at aal1: still reads its own admin row (the site asks for the code)');
update public.origins set low_stock_kg = 3 where id = 'brazil';
select is((select low_stock_kg from public.origins where id = 'brazil'), 5::numeric, 'owner at aal1: catalog write changes nothing');
select throws_ok($$select public.adjust_stock('brazil', 5, 'restock')$$, 'P0001', 'forbidden', 'owner at aal1: adjust_stock refused');
select pg_temp.token('00000000-0000-0000-0000-000000000001', 'aal2');
select is((select count(*)::int from public.origins), 2, 'owner at aal2: sees the hidden origin too');
update public.origins set low_stock_kg = 3 where id = 'brazil';
select is((select low_stock_kg from public.origins where id = 'brazil'), 3::numeric, 'owner at aal2: catalog write goes through');
select lives_ok($$select public.adjust_stock('brazil', 5, 'restock')$$, 'owner at aal2: adjust_stock allowed');

-- the shop is unchanged
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
select is((select count(*)::int from public.origins), 1, 'visitor: the active catalog, as before');
select is(public.is_admin(), false, 'visitor: not an admin');

reset role;
select * from finish(true);
rollback;
