-- ───────────── Rate limits ─────────────
-- One row per bucket ("order:phone:+2126…", "quote:ip:<hash>") counting the requests
-- of the current window: a phone or a connection cannot hold the stock with many
-- unpaid orders. The upsert locks the bucket's row, so two requests at once are
-- counted one after the other. No policy: only the server (secret key) reads or
-- writes it. IPs arrive hashed. Old buckets are removed daily (expiry_cron).
create table public.rate_limits (
  bucket       text primary key check (char_length(bucket) <= 120),
  window_start timestamptz not null default now(),
  hits         integer not null default 1
);
alter table public.rate_limits enable row level security;

-- true = allowed (and counted); false = the bucket already has p_limit hits in this window.
create or replace function public.rate_limit_hit(p_bucket text, p_limit integer, p_window_seconds integer)
returns boolean
language sql security invoker set search_path = public as $$
  insert into public.rate_limits as r (bucket) values (p_bucket)
  on conflict (bucket) do update set
    window_start = case when r.window_start < now() - make_interval(secs => p_window_seconds) then now() else r.window_start end,
    hits = case when r.window_start < now() - make_interval(secs => p_window_seconds) then 1 else least(r.hits + 1, p_limit + 1) end
  returning hits <= p_limit;
$$;

revoke all on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;
