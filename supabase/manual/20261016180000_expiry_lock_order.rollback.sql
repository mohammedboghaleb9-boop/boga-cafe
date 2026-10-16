-- ROLLBACK of 20261016180000_expiry_lock_order: puts back expire_unpaid_orders of 20260927000000_init, unchanged.
-- Supabase SQL Editor, ONE transaction. Only if the new lock order must be undone: the old function can deadlock
-- with orders in progress under load (supabase/tests/lock-stress-expiry.sh), which is why it was replaced.
-- It stops ("stop:", nothing changed) if the function on live is not the one of 20261016180000 (never a hand
-- change overwritten unseen). Grants stay as they are (create or replace keeps them: service_role only).
-- RESULT: the last select reads restored = true. AFTER: remove the history row of 20261016180000 (a separate step).
-- Tests: tests/manual-sql.test.ts keeps the restored function equal to init's.

begin;
set local lock_timeout = '3s';

do $$
begin
  if (select md5(replace(prosrc, E'\r', '')) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'expire_unpaid_orders')
       is distinct from '6314ee398d46b45d0534dbe79d1b6091' then
    raise exception 'stop: expire_unpaid_orders is not the one of 20261016180000_expiry_lock_order: tell Claude before going on';
  end if;
end $$;

-- >>> expire_unpaid_orders of 20260927000000_init.sql
create or replace function public.expire_unpaid_orders()
returns integer
language plpgsql security definer set search_path = public as $$
declare
  s       jsonb := (select settings from public.site_config where id = 1);
  v_hours numeric;
  v_check numeric;
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
  perform set_config('boga.stock_write', 'on', true);
  for v_order in
    select * from public.orders
     where status in ('new', 'confirmed')
       and ((payment_status in ('pending', 'failed') and created_at < now() - make_interval(secs => v_hours * 3600))
         or (payment_status = 'awaiting_verification' and created_at < now() - make_interval(secs => v_check * 3600)))
     order by created_at
     for update skip locked
  loop
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
-- <<< expire_unpaid_orders

do $$
begin
  if (select md5(replace(prosrc, E'\r', '')) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'expire_unpaid_orders')
       is distinct from 'f0735c7cda09173ba1dd0dad74b024c0' then
    raise exception 'stop: the restored body is not init''s';
  end if;
  if has_function_privilege('anon', 'public.expire_unpaid_orders()', 'execute')
     or has_function_privilege('authenticated', 'public.expire_unpaid_orders()', 'execute')
     or not has_function_privilege('service_role', 'public.expire_unpaid_orders()', 'execute') then
    raise exception 'stop: the rights on expire_unpaid_orders are not the expected ones';
  end if;
end $$;

commit;

select (select md5(replace(prosrc, E'\r', '')) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'expire_unpaid_orders')
       = 'f0735c7cda09173ba1dd0dad74b024c0' as restored;
