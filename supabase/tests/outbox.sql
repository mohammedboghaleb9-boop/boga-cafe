-- The outbox sender's database side (migration 20261028090000_outbox_sender): who may take and mark a message, which
-- rows are due and when, the five attempts, and a sender that died. pgTAP, run by run-local.sh on a fresh database; the
-- count is checked against plan().
\set ON_ERROR_STOP on
set client_min_messages = warning;
create extension if not exists pgtap;

begin;
select plan(21);

insert into public.notification_outbox (channel, event, recipient, subject, body) values
  ('whatsapp', 'order.created', '212600000000', '', 'one'),
  ('email', 'order.created', 'team@example.test', 'Subject', 'two'),
  ('whatsapp', 'quote.created', '212600000000', '', 'three');
insert into public.notification_outbox (channel, event, recipient, subject, body, status) values
  ('email', 'stock.low', 'team@example.test', '', 'already sent', 'sent'),
  ('email', 'stock.low', 'team@example.test', '', 'already failed', 'failed');

-- ── who ──
select ok(not has_function_privilege('anon', 'public.claim_outbox(integer, text[])', 'execute')
      and not has_function_privilege('authenticated', 'public.claim_outbox(integer, text[])', 'execute')
      and not has_function_privilege('anon', 'public.finish_outbox(bigint, boolean, text)', 'execute')
      and not has_function_privilege('authenticated', 'public.finish_outbox(bigint, boolean, text)', 'execute'),
  'visitors and signed-in users cannot take or mark a message');
select ok(has_function_privilege('service_role', 'public.claim_outbox(integer, text[])', 'execute')
      and has_function_privilege('service_role', 'public.finish_outbox(bigint, boolean, text)', 'execute'),
  'the server role can');

set local role service_role;
-- ── the first take ──
create temp table taken as select * from public.claim_outbox(10);
grant select on taken to public;
select is((select array_agg(body order by id) from taken), array['one', 'two', 'three'], 'pending rows come oldest first; sent and failed ones never');
select is((select array_agg(attempts) from taken), array[1, 1, 1], 'taking a row counts an attempt');
select is((select count(*)::int from public.claim_outbox(10)), 0, 'a second take right after gets nothing: the next attempt is one minute away');

-- ── the result ──
select public.finish_outbox((select id from taken where body = 'one'), true, null);
select public.finish_outbox((select id from taken where body = 'two'), false, 'gmail_refused');
select is((select status || '/' || coalesce(last_error, '-') || '/' || (sent_at is not null) from public.notification_outbox where body = 'one'), 'sent/-/true', 'ok: sent, a time, no error');
select is((select status || '/' || last_error || '/' || attempts from public.notification_outbox where body = 'two'), 'pending/gmail_refused/1', 'not ok: back to pending with the error class, the attempt kept');
select public.finish_outbox((select id from taken where body = 'one'), false, 'late');
select is((select status from public.notification_outbox where body = 'one'), 'sent', 'a second report on a finished message changes nothing');

-- ── when a failed message is due again: attempts² minutes after the last attempt ──
reset role;
update public.notification_outbox set last_attempt_at = now() - interval '30 seconds' where body = 'two';
set local role service_role;
select is((select count(*)::int from public.claim_outbox(10) where body = 'two'), 0, 'after 1 attempt: not due before a minute');
reset role;
update public.notification_outbox set last_attempt_at = now() - interval '61 seconds' where body = 'two';
set local role service_role;
select is((select attempts from public.claim_outbox(10) where body = 'two'), 2, 'after 1 attempt: due after a minute (2nd attempt)');
reset role;
update public.notification_outbox set last_attempt_at = now() - interval '3 minutes' where body = 'two';
set local role service_role;
select is((select count(*)::int from public.claim_outbox(10) where body = 'two'), 0, 'after 2 attempts: not due before 4 minutes');
reset role;
update public.notification_outbox set last_attempt_at = now() - interval '5 minutes' where body = 'two';
set local role service_role;
select is((select attempts from public.claim_outbox(10) where body = 'two'), 3, 'after 2 attempts: due after 4 minutes (3rd attempt)');

-- ── the fifth failure is final ──
reset role;
update public.notification_outbox set attempts = 5, last_attempt_at = now() where body = 'two';
set local role service_role;
select public.finish_outbox((select id from public.notification_outbox where body = 'two'), false, 'gmail_refused');
select is((select status from public.notification_outbox where body = 'two'), 'failed', 'failing the 5th attempt: failed, no sixth');
select is((select count(*)::int from public.claim_outbox(10) where body = 'two'), 0, 'a failed message is never taken again');

-- ── a sender that died after the 5th take ──
reset role;
update public.notification_outbox set status = 'pending', attempts = 5, last_attempt_at = now() - interval '11 minutes', last_error = null where body = 'three';
set local role service_role;
select is((select count(*)::int from public.claim_outbox(10)), 0, '5 attempts used: nothing more to take …');
select is((select status || '/' || last_error from public.notification_outbox where body = 'three'), 'failed/no_answer', '… and the message that got no answer for 10 minutes is failed (no_answer), not left pending');

-- ── a channel the sender cannot use is left alone ──
reset role;
insert into public.notification_outbox (channel, event, recipient, body) values ('email', 'order.created', 'team@example.test', 'only email'), ('whatsapp', 'order.created', '212600000000', 'only whatsapp');
set local role service_role;
select is((select array_agg(body order by id) from public.claim_outbox(10, array['whatsapp']) where body like 'only %'), array['only whatsapp'], 'asked for whatsapp only: the email waits, its attempts untouched');
select is((select attempts from public.notification_outbox where body = 'only email'), 0, 'the email message used no attempt');

-- ── limits ──
reset role;
insert into public.notification_outbox (channel, event, recipient, body) select 'email', 'stock.low', 'team@example.test', 'bulk ' || g from generate_series(1, 60) g;
set local role service_role;
select is((select count(*)::int from public.claim_outbox(1000)), 50, 'a take is cut to 50 messages');
select is((select count(*)::int from public.claim_outbox(0)), 1, 'a limit of 0 still takes one, never a negative or an empty answer');
select public.finish_outbox((select id from public.notification_outbox where body = 'bulk 1'), false, repeat('x', 500));
select is((select length(last_error) from public.notification_outbox where body = 'bulk 1'), 200, 'an error text is cut to 200 characters');
reset role;

select * from finish(true);
rollback;
