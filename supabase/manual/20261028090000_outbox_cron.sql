-- The outbox sender's schedule (P5.1): once a minute the database calls the notify-outbox Edge Function (pg_cron + pg_net),
-- with the shared key read from Vault at each call. SQL Editor, only with the owner's approval, ONLY AFTER:
--   1. migration 20261028090000_outbox_sender is applied (claim_outbox / finish_outbox exist);
--   2. the function notify-outbox is deployed and its secrets are set (Dashboard → Edge Functions → Secrets):
--      OUTBOX_KEY, GMAIL_USER, GMAIL_APP_PASSWORD, CALLMEBOT_APIKEY (a channel without its secrets is simply left alone);
--   3. the SAME key as OUTBOX_KEY is stored in Vault, once, by the owner (the value is typed here and nowhere else):
--        select vault.create_secret('<the OUTBOX_KEY value>', 'outbox_key');
-- The key is never written in this file, in the repository, or in the job's text: the job reads it from Vault at each run.
-- OFF SWITCH (stops the sending at once; the queue keeps filling and nothing is lost):  select cron.unschedule('send-outbox');
-- RESULT: one row, active = true. Check the first runs with:
--   select status_code, left(content::text, 200) from net._http_response order by id desc limit 5;

select cron.schedule(
  'send-outbox',
  '* * * * *',
  $job$
  select net.http_post(
    url := 'https://ldzagzskfmnjbkizbayr.supabase.co/functions/v1/notify-outbox',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-outbox-key', (select decrypted_secret from vault.decrypted_secrets where name = 'outbox_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $job$
);

select jobname, schedule, active from cron.job where jobname = 'send-outbox';
