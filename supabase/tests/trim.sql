-- Texts saved by the Admin Panel keep no space or line break at their start or end (P5 slice 11,
-- migration 20261012230000_config_trim): save_content (texts and contact), save_payment_method,
-- save_shipping_rate. The owner's preview test found three stray spaces in the live texts.
-- pgTAP, run by run-local.sh on a fresh database; the count is checked against plan().
\set ON_ERROR_STOP on
set client_min_messages = warning;
create extension if not exists pgtap;

begin;
select plan(40);

insert into auth.users values ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000003');
insert into public.admin_users values
  ('00000000-0000-0000-0000-000000000001', 'owner', 'Owner'),
  ('00000000-0000-0000-0000-000000000003', 'manager', 'Manager');
insert into public.admin_config values (1, '+212600000000', 'team@example.com', true, true);
insert into public.site_config (id, settings, content) values (1,
  '{"b2bThresholdKg": 10, "roastLossPercent": 0, "unpaidOrderTimeoutHours": 48, "paymentCheckTimeoutHours": 120, "freeShippingOver": 0,
    "customBlend": {"enabled": true, "minPercent": 5, "maxOrigins": 4, "feeBySize": {"250": 10, "500": 15, "1000": 20}},
    "bank": {"holder": "", "bankName": "", "rib": ""}, "cashplus": {"beneficiary": "", "city": "", "phone": ""}}',
  '{"heroTitle": {"fr": "BOGA"}}');
insert into public.payment_methods (id, label, enabled) values ('bank_transfer', '{"fr": "Virement"}', true);
insert into public.shipping_rates (id, city, base_fee) values ('oujda', '{"fr": "Oujda"}', 20);

create function pg_temp.token(p_sub text, p_aal text) returns text language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', p_sub, 'aal', p_aal)::text, true)
$$;
create function pg_temp.text(p_fr text, p_ar text default '') returns jsonb language sql as $$ select jsonb_build_object('ar', p_ar, 'fr', p_fr, 'en', '') $$;
-- the five texts as the panel sends them: only the ones given are filled
create function pg_temp.content(p_extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('announcement', pg_temp.text(''), 'heroTitle', pg_temp.text('BOGA'), 'heroSubtitle', pg_temp.text(''),
                            'aboutTitle', pg_temp.text(''), 'aboutText', pg_temp.text('')) || p_extra
$$;
create function pg_temp.contact(p_extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('whatsapp', '+212611111111', 'email', 'team@example.com', 'instagram', '', 'tiktok', '', 'facebook', '',
                            'address', pg_temp.text('Oujda'), 'hours', pg_temp.text('8:00-22:00')) || p_extra
$$;
create function pg_temp.mark(p_section text) returns text language sql as $$ select versions ->> p_section from public.site_config $$;
create function pg_temp.rate(p_id text, p_extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('id', p_id, 'city', pg_temp.text('TEST ville'), 'distanceKm', 10, 'baseFee', 30, 'includedKg', 3,
                            'extraPerKg', 5, 'deliveryDays', '2', 'active', false) || p_extra
$$;
create function pg_temp.method(p_extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('id', 'bank_transfer', 'enabled', true, 'label', pg_temp.text('Virement'), 'instructions', pg_temp.text('Merci')) || p_extra
$$;
create function pg_temp.seen_rate(p_id text) returns timestamptz language sql as $$ select updated_at from public.shipping_rates where id = p_id $$;
create function pg_temp.seen_recipients() returns timestamptz language sql as $$ select updated_at from public.admin_config $$;
create function pg_temp.seen_method() returns timestamptz language sql as $$ select updated_at from public.payment_methods where id = 'bank_transfer' $$;
set local role authenticated;
select pg_temp.token('00000000-0000-0000-0000-000000000001', 'aal2');

-- the texts: trimmed at both ends, in every language, inside a text nothing changes
select lives_ok($$select public.save_content(pg_temp.content(jsonb_build_object(
    'heroTitle', pg_temp.text(E'  \t Titre \n ', E' عنوان '),
    'aboutText', pg_temp.text(E'\n  Ligne 1\n\n  Ligne 2  \t'))), null, null, null)$$, 'owner: saves texts that start and end with spaces, tabs and line breaks');
select is((select (content #>> '{heroTitle,fr}') || '|' || (content #>> '{heroTitle,ar}') from public.site_config), E'Titre|عنوان', 'the title is kept without them, in French and in Arabic');
select is((select content #>> '{aboutText,fr}' from public.site_config), E'Ligne 1\n\n  Ligne 2', 'inside a text the line breaks and the spaces stay');
-- only these four characters go: a no-break space (U+00A0, pasted from a document) is kept, as the forms keep it (core/config.ts trimEnds)
select lives_ok($$select public.save_content(pg_temp.content(jsonb_build_object('heroTitle', pg_temp.text(E'\u00a0x\u00a0'))), null, pg_temp.mark('content'), null)$$,
                'a text between no-break spaces is saved');
select is((select content #>> '{heroTitle,fr}' from public.site_config), E'\u00a0x\u00a0', 'a no-break space is not trimmed: the same four characters as the forms');
select lives_ok($$select public.save_content(pg_temp.content(jsonb_build_object('heroTitle', pg_temp.text(repeat(' ', 10) || repeat('x', 120) || repeat(' ', 10)))),
                                              null, pg_temp.mark('content'), null)$$, 'a limit counts what is kept: 120 characters between spaces are saved');
select throws_ok($$select public.save_content(pg_temp.content(jsonb_build_object('heroTitle', pg_temp.text(repeat(' ', 10) || repeat('x', 121)))),
                                                null, pg_temp.mark('content'), null)$$, 'P0001', 'invalid_content', '121 characters are still refused');
select throws_ok($$select public.save_content(pg_temp.content(jsonb_build_object('heroTitle', jsonb_build_object('fr', 5))), null, pg_temp.mark('content'), null)$$,
                 'P0001', 'invalid_content', 'a text sent as a number is refused, never changed');
select throws_ok($$select public.save_content(pg_temp.content() - 'aboutText', null, pg_temp.mark('content'), null)$$,
                 'P0001', 'invalid_content', 'a missing text is refused');

-- the contact details: a pasted link or number with a space around it is saved clean
select lives_ok($$select public.save_content(pg_temp.content(), pg_temp.contact(jsonb_build_object(
    'whatsapp', ' +212611111111 ', 'email', E' team@example.com\n', 'facebook', ' https://facebook.com/boga ', 'address', pg_temp.text(' Oujda ', ' وجدة '))),
    pg_temp.mark('content'), null)$$, 'owner: saves contact details with spaces around them');
select is((select (settings #>> '{contact,whatsapp}') || '|' || (settings #>> '{contact,email}') || '|' || (settings #>> '{contact,facebook}') || '|' || (settings #>> '{contact,address,fr}')
           from public.site_config), '+212611111111|team@example.com|https://facebook.com/boga|Oujda', 'the contact details are kept without them');
select throws_ok($$select public.save_content(pg_temp.content(), pg_temp.contact('{"facebook": "https://face book.com"}'), pg_temp.mark('content'), pg_temp.mark('contact'))$$,
                 'P0001', 'invalid_contact', 'a space inside a link is still refused: trimming hides nothing');

-- the manager's texts are trimmed too
select pg_temp.token('00000000-0000-0000-0000-000000000003', 'aal2');
select lives_ok($$select public.save_content(pg_temp.content(jsonb_build_object('announcement', pg_temp.text('  Livraison  '))), null, pg_temp.mark('content'), null)$$, 'manager: saves a text with spaces');
select is((select content #>> '{announcement,fr}' from public.site_config), 'Livraison', 'the manager''s text is kept without them');

-- message recipients: a number or an address pasted with a space around it
select pg_temp.token('00000000-0000-0000-0000-000000000001', 'aal2');
select lives_ok($$select public.save_recipients(jsonb_build_object('adminWhatsapp', ' +212600000000 ', 'adminEmail', E' team@example.com\n', 'whatsappEnabled', true, 'emailEnabled', true),
                                                 pg_temp.seen_recipients())$$, 'owner: saves recipients with spaces around them');
select is((select admin_whatsapp || '|' || admin_email from public.admin_config), '+212600000000|team@example.com', 'the recipients are kept without them');

-- payment methods: label and instructions
select pg_temp.token('00000000-0000-0000-0000-000000000001', 'aal2');
select lives_ok($$select public.save_payment_method(pg_temp.method(jsonb_build_object('label', pg_temp.text('  Virement bancaire '), 'instructions', pg_temp.text(E'\n Faites un virement. \n'))),
                                                    pg_temp.seen_method())$$, 'owner: saves a payment method whose texts have spaces and line breaks around them');
select is((select (label ->> 'fr') || '|' || (instructions ->> 'fr') from public.payment_methods where id = 'bank_transfer'), 'Virement bancaire|Faites un virement.', 'its texts are kept without them');
select throws_ok($$select public.save_payment_method(pg_temp.method(jsonb_build_object('label', pg_temp.text('   '))), pg_temp.seen_method())$$,
                 'P0001', 'invalid_method', 'a label made of spaces is refused: the French label is required');
select throws_ok($$select public.save_payment_method(pg_temp.method(jsonb_build_object('instructions', pg_temp.text(repeat('x', 601)))), pg_temp.seen_method())$$,
                 'P0001', 'invalid_method', 'instructions of 601 characters are refused');

-- delivery prices: city names and delivery days
select pg_temp.token('00000000-0000-0000-0000-000000000003', 'aal2');
select is(public.save_shipping_rate(pg_temp.rate('test-ville', jsonb_build_object('city', pg_temp.text(' TEST ville ', ' تجريب '), 'deliveryDays', ' 2-3 ')), null), 'test-ville',
          'manager: adds a city whose name and delivery days have spaces around them');
select is((select (city ->> 'fr') || '|' || (city ->> 'ar') || '|' || delivery_days from public.shipping_rates where id = 'test-ville'), 'TEST ville|تجريب|2-3', 'the new city is kept without them');
select lives_ok($$select public.save_shipping_rate(pg_temp.rate('test-ville', jsonb_build_object('city', pg_temp.text('  Autre ville  '), 'deliveryDays', ' 4 ')), pg_temp.seen_rate('test-ville'))$$,
                'manager: edits the city with spaces around its texts');
select is((select (city ->> 'fr') || '|' || delivery_days from public.shipping_rates where id = 'test-ville'), 'Autre ville|4', 'the edited city is kept without them');
select throws_ok($$select public.save_shipping_rate(pg_temp.rate('test-ville', jsonb_build_object('city', pg_temp.text('   '))), pg_temp.seen_rate('test-ville'))$$,
                 'P0001', 'invalid_rate', 'a city name made of spaces is refused');
select throws_ok($$select public.save_shipping_rate(pg_temp.rate('test-ville', jsonb_build_object('deliveryDays', repeat('9', 21))), pg_temp.seen_rate('test-ville'))$$,
                 'P0001', 'invalid_rate', 'delivery days of 21 characters are refused');

-- nothing, an array or a scalar instead of the object: the clean refusal of before, never a raw error
select pg_temp.token('00000000-0000-0000-0000-000000000001', 'aal2');
select throws_ok($$select public.save_content(null::jsonb, null, null, null)$$, 'P0001', 'invalid_content', 'no texts at all is refused');
select throws_ok($$select public.save_recipients(null::jsonb, pg_temp.seen_recipients())$$, 'P0001', 'invalid_recipients', 'no recipients at all is refused');
select throws_ok($$select public.save_payment_method('[]'::jsonb, pg_temp.seen_method())$$, 'P0001', 'invalid_method', 'a payment method sent as an array is refused');
select throws_ok($$select public.save_shipping_rate('{"id": "ville-x", "city": 5}'::jsonb, null)$$, 'P0001', 'invalid_rate', 'a city name sent as a number is refused');

-- a key that is not sent: refused as before, never a raw error. The rebuild with jsonb_build_object turns it into a JSON null
-- (not an SQL NULL: the two are different values), and the checks refuse both alike, which is why the rebuild is safe here
select pg_temp.token('00000000-0000-0000-0000-000000000001', 'aal2');
select throws_ok($$select public.save_content(pg_temp.content(), pg_temp.contact() - 'tiktok', pg_temp.mark('content'), pg_temp.mark('contact'))$$,
                 'P0001', 'invalid_contact', 'a contact detail that is not sent is still refused');
select throws_ok($$select public.save_recipients(jsonb_build_object('adminWhatsapp', '+212600000000', 'whatsappEnabled', true, 'emailEnabled', true), pg_temp.seen_recipients())$$,
                 'P0001', 'invalid_recipients', 'a recipient that is not sent is still refused');
select throws_ok($$select public.save_payment_method(pg_temp.method() - 'instructions', pg_temp.seen_method())$$, 'P0001', 'invalid_method', 'payment instructions that are not sent are still refused');
select throws_ok($$select public.save_shipping_rate(pg_temp.rate('test-ville') - 'deliveryDays', pg_temp.seen_rate('test-ville'))$$, 'P0001', 'invalid_rate', 'delivery days that are not sent are still refused');
reset role;
select is((jsonb_build_object('adminEmail', ('{}'::jsonb) -> 'adminEmail') -> 'adminEmail') is null, false,
          'jsonb_build_object of a missing key makes a JSON null, which is not an SQL NULL');
select is(public.config_string_ok(null::jsonb, 120) or public.config_string_ok('null'::jsonb, 120), false, 'a string check refuses the SQL NULL and the JSON null alike');
select is(public.config_text_ok(null::jsonb, 200) or public.config_text_ok('null'::jsonb, 200), false, 'a text check refuses the SQL NULL and the JSON null alike');
select is(public.config_trim_str(null::jsonb) is null and jsonb_typeof(public.config_trim_str('null'::jsonb)) = 'null', true,
          'the trim helpers keep an SQL NULL as NULL and a JSON null as a JSON null');
select is(public.config_trim_text(null::jsonb) is null and jsonb_typeof(public.config_trim_text('null'::jsonb)) = 'null', true, 'same for a text');
set local role authenticated;

-- the helpers are the functions' own: no API role runs them
select is((select has_function_privilege('authenticated', 'public.config_trim_str(jsonb)', 'execute') or has_function_privilege('anon', 'public.config_trim_text(jsonb)', 'execute')), false,
          'no API role can run the trim helpers');

reset role;
select * from finish(true);
rollback;
