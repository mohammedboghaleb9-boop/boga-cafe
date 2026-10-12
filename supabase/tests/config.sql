-- Settings, payments, texts, recipients and delivery writes (P5 slice 10): one function per
-- part, each role within its limits at aal2, every value checked, a payee whole or empty,
-- the card kept off, older copies refused, and no direct write left to the API roles.
-- pgTAP, run by run-local.sh on a fresh database; the count is checked against plan().
\set ON_ERROR_STOP on
set client_min_messages = warning;
create extension if not exists pgtap;

begin;
select plan(40);

insert into auth.users values
  ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002'), ('00000000-0000-0000-0000-000000000003');
insert into public.admin_users values
  ('00000000-0000-0000-0000-000000000001', 'owner', 'Owner'),
  ('00000000-0000-0000-0000-000000000002', 'staff', 'Staff'),
  ('00000000-0000-0000-0000-000000000003', 'manager', 'Manager');
insert into public.admin_config values (1, '+212600000000', 'team@example.com', true, true);
insert into public.site_config (id, settings, content) values (1,
  '{"b2bThresholdKg": 10, "roastLossPercent": 0, "unpaidOrderTimeoutHours": 48, "paymentCheckTimeoutHours": 120, "freeShippingOver": 0,
    "customBlend": {"enabled": true, "minPercent": 5, "maxOrigins": 4, "feeBySize": {"250": 10, "500": 15, "1000": 20}},
    "bank": {"holder": "", "bankName": "", "rib": ""}, "cashplus": {"beneficiary": ""}}',
  '{"heroTitle": {"fr": "BOGA"}}');
insert into public.payment_methods (id, label, enabled) values ('card', '{"fr": "Carte"}', false), ('bank_transfer', '{"fr": "Virement"}', true);
insert into public.shipping_rates (id, city, base_fee) values ('oujda', '{"fr": "Oujda"}', 20);

create function pg_temp.token(p_sub text, p_aal text) returns text language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', p_sub, 'aal', p_aal)::text, true)
$$;
-- each part as the panel sends it, and its version as the page read it
create function pg_temp.rules(p_extra jsonb default '{}') returns jsonb language sql as $$
  select '{"b2bThresholdKg": 11, "roastLossPercent": 0, "unpaidOrderTimeoutHours": 48, "paymentCheckTimeoutHours": 120,
           "customBlend": {"enabled": true, "minPercent": 5, "maxOrigins": 4, "feeBySize": {"250": 10, "500": 15, "1000": 20}}}'::jsonb || p_extra
$$;
create function pg_temp.payee(p_bank jsonb, p_cash jsonb) returns jsonb language sql as $$
  select jsonb_build_object('bank', p_bank, 'cashplus', p_cash)
$$;
create function pg_temp.text(p_fr text) returns jsonb language sql as $$ select jsonb_build_object('ar', '', 'fr', p_fr, 'en', '') $$;
create function pg_temp.content(p_title text default 'BOGA') returns jsonb language sql as $$
  select jsonb_build_object('announcement', pg_temp.text(''), 'heroTitle', pg_temp.text(p_title), 'heroSubtitle', pg_temp.text(''),
                            'aboutTitle', pg_temp.text(''), 'aboutText', pg_temp.text(''))
$$;
create function pg_temp.contact(p_extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('whatsapp', '+212611111111', 'email', 'TEST@example.com', 'instagram', 'https://instagram.com/test',
                            'tiktok', '', 'facebook', '', 'address', pg_temp.text('Oujda'), 'hours', pg_temp.text('8:00-22:00')) || p_extra
$$;
create function pg_temp.mark(p_section text) returns text language sql as $$ select versions ->> p_section from public.site_config $$;
create function pg_temp.rate(p_id text, p_extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('id', p_id, 'city', pg_temp.text('TEST ville'), 'distanceKm', 10, 'baseFee', 30, 'includedKg', 3,
                            'extraPerKg', 5, 'deliveryDays', '2', 'active', true) || p_extra
$$;
create function pg_temp.seen_rate(p_id text) returns timestamptz language sql as $$ select updated_at from public.shipping_rates where id = p_id $$;
create function pg_temp.seen_method(p_id text) returns timestamptz language sql as $$ select updated_at from public.payment_methods where id = p_id $$;
create function pg_temp.seen_recipients() returns timestamptz language sql as $$ select updated_at from public.admin_config $$;
create temp table seen (part text primary key, at text);
grant all on seen to authenticated;
set local role authenticated;

-- who may save what: the owner's parts, then the shared ones; never at aal1, never staff
select pg_temp.token('00000000-0000-0000-0000-000000000001', 'aal1');
select throws_ok($$select public.save_rules(pg_temp.rules(), null)$$, 'P0001', 'forbidden', 'owner at aal1: rules refused');
select pg_temp.token('00000000-0000-0000-0000-000000000003', 'aal2');
select throws_ok($$select public.save_rules(pg_temp.rules(), null)$$, 'P0001', 'forbidden', 'manager: the rules are the owner''s');
select throws_ok($$select public.save_payee(pg_temp.payee('{"holder": "", "bankName": "", "rib": ""}', '{"beneficiary": "", "city": "", "phone": ""}'), null)$$,
                 'P0001', 'forbidden', 'manager: the payee is the owner''s');
select throws_ok($$select public.save_payment_method('{"id": "bank_transfer", "enabled": false, "label": {"fr": "Virement"}, "instructions": {}}', pg_temp.seen_method('bank_transfer'))$$,
                 'P0001', 'forbidden', 'manager: payment methods are the owner''s');
select throws_ok($$select public.save_recipients('{"adminWhatsapp": "", "adminEmail": "", "whatsappEnabled": false, "emailEnabled": false}', pg_temp.seen_recipients())$$,
                 'P0001', 'forbidden', 'manager: message recipients are the owner''s');
select throws_ok($$select public.save_content(pg_temp.content(), pg_temp.contact(), null, null)$$, 'P0001', 'owner_only', 'manager: the contact details are the owner''s');
select pg_temp.token('00000000-0000-0000-0000-000000000002', 'aal2');
select throws_ok($$select public.save_free_shipping(100, null)$$, 'P0001', 'forbidden', 'staff: no setting at all');
select throws_ok($$select public.save_shipping_rate(pg_temp.rate('test-ville'), null)$$, 'P0001', 'forbidden', 'staff: no delivery price');

-- the rules: owner, checked, from the version read
select pg_temp.token('00000000-0000-0000-0000-000000000001', 'aal2');
select lives_ok($$select public.save_rules(pg_temp.rules('{"bank": {"holder": "X", "bankName": "X", "rib": "X"}}'), null)$$, 'owner: saves the rules');
select is((select (settings ->> 'b2bThresholdKg') || ' ' || (settings #>> '{bank,holder}') from public.site_config), '11 ',
          'the rules are saved, and nothing else the page sends (the payee stays as it was)');
select throws_ok($$select public.save_rules(pg_temp.rules(), null)$$, 'P0001', 'stale', 'rules from an older copy are refused');
select throws_ok($$select public.save_rules(pg_temp.rules('{"roastLossPercent": 31}'), pg_temp.mark('rules'))$$, 'P0001', 'invalid_settings', 'a roasting loss above 30 % is refused');
select throws_ok($$select public.save_rules(pg_temp.rules('{"customBlend": {"enabled": true, "minPercent": 2.5, "maxOrigins": 4, "feeBySize": {"250": 10, "500": 15, "1000": 20}}}'), pg_temp.mark('rules'))$$,
                 'P0001', 'invalid_settings', 'a minimum share that is not a whole percentage is refused');
select throws_ok($$select public.save_rules(pg_temp.rules('{"unpaidOrderTimeoutHours": 0}'), pg_temp.mark('rules'))$$, 'P0001', 'invalid_settings', 'a stock hold of 0 hours is refused');

-- the payee: whole or empty, a 24-digit RIB, never an identity card number
select lives_ok($$select public.save_payee(pg_temp.payee('{"holder": " TEST ", "bankName": "TEST", "rib": "000000000000000000000000"}',
                                                         '{"beneficiary": "TEST", "city": "Oujda", "phone": "0600000000", "cin": "AB123456"}'), null)$$,
                'owner: saves the payee');
select is((select (settings #>> '{bank,holder}') || '/' || (settings -> 'cashplus')::text from public.site_config),
          'TEST/{"city": "Oujda", "phone": "0600000000", "beneficiary": "TEST"}', 'trimmed, and no other field kept: no identity card number');
select throws_ok($$select public.save_payee(pg_temp.payee('{"holder": "TEST", "bankName": "TEST", "rib": "00000000000000000000000"}', '{"beneficiary": "", "city": "", "phone": ""}'), pg_temp.mark('payee'))$$,
                 'P0001', 'invalid_payee', 'a RIB of 23 digits is refused');
select throws_ok($$select public.save_payee(pg_temp.payee('{"holder": "TEST", "bankName": "", "rib": ""}', '{"beneficiary": "", "city": "", "phone": ""}'), pg_temp.mark('payee'))$$,
                 'P0001', 'incomplete_payee', 'half a payee is refused: a method is offered only once its payee is whole');
select throws_ok($$select public.save_payee(pg_temp.payee('{"holder": "", "bankName": "", "rib": ""}', '{"beneficiary": "", "city": "", "phone": ""}'), null)$$,
                 'P0001', 'stale', 'a payee from an older copy is refused');

-- texts: the manager's, contact the owner's; each part has its own version
select pg_temp.token('00000000-0000-0000-0000-000000000003', 'aal2');
insert into seen select 'rules', pg_temp.mark('rules');
select lives_ok($$select public.save_content(pg_temp.content('TEST titre'), null, null, null)$$, 'manager: saves the texts');
select pg_temp.token('00000000-0000-0000-0000-000000000001', 'aal2');
select lives_ok($$select public.save_rules(pg_temp.rules('{"b2bThresholdKg": 12}'), (select at from seen where part = 'rules'))$$,
                'a text saved meanwhile never refuses the owner''s rules');
select lives_ok($$select public.save_content(pg_temp.content(), pg_temp.contact(), pg_temp.mark('content'), null)$$, 'owner: saves the texts with the contact details');
select is((select (content #>> '{heroTitle,fr}') || ' ' || (settings #>> '{contact,email}') from public.site_config), 'BOGA TEST@example.com', 'texts and contact saved together');
select throws_ok($$select public.save_content(pg_temp.content(), pg_temp.contact('{"facebook": "http://facebook.com/x"}'), pg_temp.mark('content'), pg_temp.mark('contact'))$$,
                 'P0001', 'invalid_contact', 'a link that is not https is refused');
select throws_ok($$select public.save_content(pg_temp.content(), null, null, null)$$, 'P0001', 'stale', 'texts from an older copy are refused');

-- free shipping, recipients, methods
select throws_ok($$select public.save_free_shipping('NaN', null)$$, 'P0001', 'invalid_settings', 'a NaN threshold is refused');
select pg_temp.token('00000000-0000-0000-0000-000000000003', 'aal2');
select lives_ok($$select public.save_free_shipping(300, null)$$, 'manager: saves the free-shipping threshold');
select pg_temp.token('00000000-0000-0000-0000-000000000001', 'aal2');
select throws_ok($$select public.save_recipients('{"adminWhatsapp": "", "adminEmail": "not-an-email", "whatsappEnabled": true, "emailEnabled": true}', pg_temp.seen_recipients())$$,
                 'P0001', 'invalid_recipients', 'a recipient that is not an email address is refused');
select lives_ok($$select public.save_recipients('{"adminWhatsapp": "+212600000000", "adminEmail": "team@example.com", "whatsappEnabled": false, "emailEnabled": true}', pg_temp.seen_recipients())$$,
                'owner: switches the WhatsApp messages off');
select throws_ok($$select public.save_payment_method('{"id": "card", "enabled": true, "label": {"fr": "Carte"}, "instructions": {}}', pg_temp.seen_method('card'))$$,
                 'P0001', 'card_unavailable', 'the card cannot be switched on before its gateway exists');
select throws_ok($$select public.save_payment_method('{"id": "bank_transfer", "enabled": true, "label": {"fr": "TEST"}, "instructions": {}}', '2026-01-01')$$,
                 'P0001', 'stale', 'a payment method from an older copy is refused');

-- delivery: a new city hidden, its id fixed, its prices checked
select pg_temp.token('00000000-0000-0000-0000-000000000003', 'aal2');
select is(public.save_shipping_rate(pg_temp.rate('test-ville'), null), 'test-ville', 'manager: adds a city');
select is((select active from public.shipping_rates where id = 'test-ville'), false, 'a new city is created hidden, whatever is asked');
select lives_ok($$select public.save_shipping_rate(pg_temp.rate('test-ville', '{"baseFee": 35, "active": false}'), pg_temp.seen_rate('test-ville'))$$, 'manager: edits the city from the copy read');
select throws_ok($$select public.save_shipping_rate(pg_temp.rate('test-ville', '{"baseFee": 2000}'), pg_temp.seen_rate('test-ville'))$$, 'P0001', 'invalid_rate', 'a delivery fee above 1000 DH is refused');
select throws_ok($$select public.save_shipping_rate(pg_temp.rate('other-ville'), pg_temp.seen_rate('test-ville'))$$, 'P0001', 'not_found', 'an edit under another id renames nothing');

-- every save recorded once, with who did it; a refused one leaves no line
select is((select string_agg(area || ':' || substr(actor::text, 36), ' ' order by id) from public.config_changes),
          'rules:1 payee:1 content:3 rules:1 content:1 contact:1 free_shipping:3 recipients:1 shipping_rate:3 shipping_rate:3', 'each save is recorded once, with who did it');

-- no role writes these tables directly through the API
select pg_temp.token('00000000-0000-0000-0000-000000000001', 'aal2');
select throws_ok($$update public.site_config set settings = settings || '{"bank": {"holder": "ATTACKER", "bankName": "X", "rib": "1"}}'$$, '42501', null,
                 'owner: the payee cannot be changed directly');
select throws_ok($$update public.shipping_rates set base_fee = 0$$, '42501', null, 'owner: delivery prices cannot be changed directly');
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
select throws_ok($$select count(*) from public.admin_config$$, '42501', null, 'visitor: who receives the messages is not read');

reset role;
select * from finish(true);
rollback;
