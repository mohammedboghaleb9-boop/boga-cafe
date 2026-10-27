-- The outbox sender's two database functions (P5.1; sender = supabase/functions/notify-outbox).
--
-- notification_outbox rows are queued with the order or request that made them (queue_notification), status
-- 'pending'. The sender (an Edge Function called every minute) takes a few due rows with claim_outbox() and reports
-- each result with finish_outbox(). Both are for service_role only: nobody else may take, mark or resend a message.
--
-- claim_outbox(limit, channels): up to `limit` (1 to 50) pending rows of those channels (default both) that are due,
--   oldest first (a channel the sender has no secret for is left out, so its messages wait instead of using up their
--   attempts), FOR UPDATE SKIP LOCKED, so
--   two senders running at once never take the same row. Taking a row counts an attempt (attempts + 1,
--   last_attempt_at = now()). A row is due when it has no attempt yet, or its last attempt is older than
--   attempts² minutes (1, 4, 9, 16 minutes between the five attempts). A row that took its 5th attempt and got no
--   answer (the sender died) for 10 minutes is marked 'failed' (last_error 'no_answer'), never left pending.
-- finish_outbox(id, ok, error): ok → status 'sent', sent_at now, no error; not ok → the error (cut to 200 characters,
--   a class like 'gmail_refused', never a message text or a key) and status 'failed' after the 5th attempt, else
--   back to 'pending' for the next attempt. Only a row that is still 'pending' changes (a second report is ignored).
--
-- The column last_attempt_at is new; no row changes. Rollback: supabase/manual/20261028090000_outbox_sender.rollback.sql.
-- No DROP of anything that exists, so the migration tool can run it; the history version is recorded with it.

alter table public.notification_outbox add column last_attempt_at timestamptz;

create or replace function public.claim_outbox(p_limit integer default 10, p_channels text[] default array['whatsapp', 'email'])
returns setof public.notification_outbox
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.notification_outbox
     set status = 'failed', last_error = 'no_answer'
   where status = 'pending' and attempts >= 5 and last_attempt_at <= now() - interval '10 minutes';
  return query
  with due as (
    select id from public.notification_outbox
     where status = 'pending' and attempts < 5 and channel = any (p_channels)
       and (last_attempt_at is null or last_attempt_at <= now() - (attempts * attempts) * interval '1 minute')
     order by id
     limit greatest(1, least(coalesce(p_limit, 10), 50))
       for update skip locked
  )
  update public.notification_outbox o
     set attempts = o.attempts + 1, last_attempt_at = now()
    from due
   where o.id = due.id
  returning o.*;
end $$;

create or replace function public.finish_outbox(p_id bigint, p_ok boolean, p_error text default null)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.notification_outbox
     set status = case when p_ok then 'sent' when attempts >= 5 then 'failed' else 'pending' end,
         sent_at = case when p_ok then now() else sent_at end,
         last_error = case when p_ok then null else left(coalesce(nullif(btrim(p_error), ''), 'failed'), 200) end
   where id = p_id and status = 'pending';
end $$;

revoke all on function public.claim_outbox(integer, text[]) from public, anon, authenticated;
revoke all on function public.finish_outbox(bigint, boolean, text) from public, anon, authenticated;
grant execute on function public.claim_outbox(integer, text[]) to service_role;
grant execute on function public.finish_outbox(bigint, boolean, text) to service_role;
