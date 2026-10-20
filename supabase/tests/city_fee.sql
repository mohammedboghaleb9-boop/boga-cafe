-- A shown delivery city has a base fee above 0 (P5 slice 13, migration 20261020090000_city_shown_needs_fee),
-- whoever writes: the Admin Panel's function, a direct table write, the service key. A hidden city may keep 0.
-- pgTAP, run by run-local.sh on a fresh database; the count is checked against plan().
\set ON_ERROR_STOP on
set client_min_messages = warning;
create extension if not exists pgtap;

begin;
select plan(8);

insert into auth.users values ('00000000-0000-0000-0000-000000000001');
insert into public.admin_users values ('00000000-0000-0000-0000-000000000001', 'owner', 'Owner');
-- the real start: fees 0, hidden
insert into public.shipping_rates (id, city, distance_km, base_fee, included_kg, extra_per_kg, delivery_days, active)
values ('oujda', '{"fr": "Oujda"}', 0, 0, 3, 0, '1', false);

select lives_ok($$update public.shipping_rates set extra_per_kg = 10 where id = 'oujda'$$, 'a hidden city keeps a base fee of 0');
select throws_ok($$update public.shipping_rates set active = true where id = 'oujda'$$, '23514', null,
  'a direct write cannot show a city with a base fee of 0');
select throws_ok($$update public.shipping_rates set active = true, max_fee = 0 where id = 'oujda'$$, '23514', null,
  'nor with a cap of 0 (free up to any weight)');
select throws_ok($$insert into public.shipping_rates (id, city, distance_km, base_fee, included_kg, extra_per_kg, delivery_days, active)
                   values ('nador', '{"fr": "Nador"}', 130, 0, 3, 10, '1', true)$$, '23514', null, 'nor add a shown city at 0');

set local role service_role;
select throws_ok($$update public.shipping_rates set active = true where id = 'oujda'$$, '23514', null,
  'the service key cannot either (it bypasses row security, not this check)');
reset role;

-- the owner, signed in with the second factor, through the Admin Panel's function
select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-000000000001", "aal": "aal2"}', true);
set local role authenticated;
select throws_ok($$select public.save_shipping_rate(jsonb_build_object('id', 'oujda', 'city', jsonb_build_object('fr', 'Oujda'), 'distanceKm', 0,
                     'baseFee', 0, 'includedKg', 3, 'extraPerKg', 10, 'deliveryDays', '1', 'active', true),
                   (select updated_at from public.shipping_rates where id = 'oujda'))$$, '23514', null,
  'save_shipping_rate cannot show it at 0 either');
-- showing it and giving it its fee in the same save: accepted, the included weight as the owner sets it (3 kg)
select lives_ok($$select public.save_shipping_rate(jsonb_build_object('id', 'oujda', 'city', jsonb_build_object('fr', 'Oujda'), 'distanceKm', 0,
                    'baseFee', 20, 'includedKg', 3, 'extraPerKg', 10, 'maxFee', 30, 'deliveryDays', '1', 'active', true),
                  (select updated_at from public.shipping_rates where id = 'oujda'))$$, 'shown with its fee in one save');
reset role;
select is((select (active, base_fee, included_kg, extra_per_kg, max_fee)::text from public.shipping_rates where id = 'oujda'),
  '(t,20.00,3.000,10.00,30.00)', 'saved as sent: shown, 20 DH, 3 kg included, 10 DH per extra kg, cap 30');

select * from finish(true);
rollback;
