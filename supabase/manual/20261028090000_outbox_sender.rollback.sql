-- ROLLBACK of 20261028090000_outbox_sender: the two functions and the column go. Supabase SQL Editor (it holds DROPs),
-- ONE transaction, only with the owner's approval. Stop the sender's cron job first (supabase/manual/*_outbox_cron.sql
-- has its own off switch), or its calls fail until the function is gone too.
-- AFTER: remove the history row of 20261028090000 (a separate step).

begin;
set local lock_timeout = '3s';
drop function public.claim_outbox(integer, text[]);
drop function public.finish_outbox(bigint, boolean, text);
alter table public.notification_outbox drop column last_attempt_at;
commit;

select
  (select count(*) from pg_proc where proname in ('claim_outbox', 'finish_outbox') and pronamespace = 'public'::regnamespace) as functions,
  (select count(*) from information_schema.columns where table_name = 'notification_outbox' and column_name = 'last_attempt_at') as column_present;
