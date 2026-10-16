-- The expiry cron in the same lock order as the orders (found by supabase/tests/lock-stress-expiry.sh, slice 12).
--
-- expire_unpaid_orders (20260927000000_init) returned the stock order after order: each order's origins in id
-- order, but across orders in no fixed order (the orders go by age). commit_order, set_order_status and
-- save_product take the origins in id order. So under load the cron could hold one origin of an older order,
-- wait for one of the next, while an order in progress held that one and waited for the first: a deadlock, one
-- side aborted (a customer's order fails, or the 15-minute batch is retried). supabase/tests/lock-stress-expiry.sh
-- reproduces it on the old function.
--
-- Now the cron takes its locks in two passes, like every other path: first the orders it expires (skip locked,
-- as before: one an admin is changing waits for the next run), then every origin whose stock comes back, in one
-- statement, in id order (no key update: the lock its stock update takes anyway, so admins saving a product, who
-- hold the origins for key share, are not waited for). Then the same returns as before, order by order: stock
-- given back once (stock_returned), one history line per origin, the order cancelled with one 'status.expired'.
-- It never waits on an order (skip locked), and it takes all its origins at once in id order, as the others do,
-- so it closes no cycle.
--
-- Only the function changes (no row, no table): the tool that applies migrations can run it. It stops if the
-- function on live is missing, or neither the one of init nor this one (a hand change is never overwritten
-- unseen). search_path becomes 'public, pg_temp' (init: 'public'), as in the later migrations. The rights are
-- set again at the end, as init set them (service_role only).
-- Rollback: supabase/manual/20261016180000_expiry_lock_order.rollback.sql (puts init's function back).

do $$
begin
  if coalesce((select md5(replace(prosrc, E'\r', '')) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'expire_unpaid_orders'), '')
       not in ('f0735c7cda09173ba1dd0dad74b024c0', '6314ee398d46b45d0534dbe79d1b6091') then
    raise exception 'stop: expire_unpaid_orders on this database is not the one of 20260927000000_init: tell Claude before going on';
  end if;
end $$;

create or replace function public.expire_unpaid_orders()
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s       jsonb := (select settings from public.site_config where id = 1);
  v_hours numeric;
  v_check numeric;
  v_ids   uuid[];
  v_order public.orders;
  d       jsonb;
  n       integer := 0;
begin
  v_hours := case when jsonb_typeof(s -> 'unpaidOrderTimeoutHours') = 'number'
                   and (s ->> 'unpaidOrderTimeoutHours')::numeric >= 1
                  then (s ->> 'unpaidOrderTimeoutHours')::numeric else 48 end;
  v_check := greatest(v_hours, case when jsonb_typeof(s -> 'paymentCheckTimeoutHours') = 'number'
                                     and (s ->> 'paymentCheckTimeoutHours')::numeric >= 1
                                    then (s ->> 'paymentCheckTimeoutHours')::numeric else 120 end);
  -- 1. the orders to expire, locked now (one held by another session waits for the next run)
  with due as (
    select o.id from public.orders o
     where o.status in ('new', 'confirmed')
       and ((o.payment_status in ('pending', 'failed') and o.created_at < now() - make_interval(secs => v_hours * 3600))
         or (o.payment_status = 'awaiting_verification' and o.created_at < now() - make_interval(secs => v_check * 3600)))
     order by o.created_at
     for update skip locked
  )
  select coalesce(array_agg(id), '{}') into v_ids from due;
  if cardinality(v_ids) = 0 then
    return 0;
  end if;
  -- 2. every origin whose stock comes back, in one statement and in id order, before any is updated
  perform 1 from public.origins o
   where o.id in (select x ->> 'originId'
                    from public.orders r, jsonb_array_elements(r.stock_deductions) x
                   where r.id = any(v_ids) and not r.stock_returned)
   order by o.id
   for no key update;
  -- 3. the same returns as before, oldest order first
  perform set_config('boga.stock_write', 'on', true);
  for v_order in select * from public.orders where id = any(v_ids) order by created_at loop
    if not v_order.stock_returned then
      for d in select value from jsonb_array_elements(v_order.stock_deductions) order by value ->> 'originId' loop
        update public.origins set stock_kg = stock_kg + (d ->> 'kg')::numeric where id = d ->> 'originId';
        insert into public.stock_movements (origin_id, delta_kg, reason, ref, note)
        values (d ->> 'originId', (d ->> 'kg')::numeric, 'order_cancelled', v_order.number, 'auto');
      end loop;
    end if;
    update public.orders set status = 'cancelled', stock_returned = true where id = v_order.id;
    insert into public.order_events (order_id, label) values (v_order.id, 'status.expired');
    n := n + 1;
  end loop;
  perform set_config('boga.stock_write', '', true);
  return n;
end $$;

revoke all on function public.expire_unpaid_orders() from public, anon, authenticated;
grant execute on function public.expire_unpaid_orders() to service_role;
