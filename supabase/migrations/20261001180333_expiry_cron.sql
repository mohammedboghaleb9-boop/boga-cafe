-- ───────────── Every reservation ends ─────────────
-- expire_unpaid_orders() every 15 minutes, old rate-limit buckets once a day (pg_cron). Skipped on a plain PostgreSQL
-- without the extension (local tests call the function directly).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('expire-unpaid-orders', '*/15 * * * *', 'select public.expire_unpaid_orders()');
    perform cron.schedule('forget-rate-limits', '17 3 * * *',
                          $job$delete from public.rate_limits where window_start < now() - interval '2 days'$job$);
  end if;
end $$;
