-- ROLLBACK of 20261115090000_cod_unconfirmed_expiry: set_order_status and expire_unpaid_orders as
-- 20261110120000_cod wrote them (a cod order never expires again, any admin marks it delivered again).
-- Supabase SQL Editor, ONE transaction, only with the owner's approval.
-- It stops ("stop:", nothing changed) if a function is not the one of 20261115090000 (never a hand change overwritten
-- unseen). Orders already cancelled by the 24 hours stay cancelled, their stock already back: nothing to undo there.
-- RESULT: the last select reads restored 2.
-- AFTER: remove the history row of 20261115090000 (a separate step).
-- Tests: tests/manual-sql.test.ts keeps each restored function equal to 20261110120000_cod's.

begin;
set local lock_timeout = '3s';

do $$
begin
  if (select md5(replace(prosrc, E'\r', '')) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'set_order_status')
       is distinct from '7a7ea43dda1387a5616d9ced6e8aad1f' then
    raise exception 'stop: set_order_status is not the one of 20261115090000_cod_unconfirmed_expiry: tell Claude before going on';
  end if;
  if (select md5(replace(prosrc, E'\r', '')) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'expire_unpaid_orders')
       is distinct from '28f43ad74e38f0f292344a8f5e56517a' then
    raise exception 'stop: expire_unpaid_orders is not the one of 20261115090000_cod_unconfirmed_expiry: tell Claude before going on';
  end if;
end $$;

create or replace function public.set_order_status(p_order_id uuid, p_status text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_order public.orders;
  d       jsonb;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_order.status in ('cancelled', 'delivered', 'returned') then
    raise exception 'closed';
  end if;
  -- Same rules as src/core/orderFlow.ts: one step at a time, nothing prepaid produced
  -- or shipped before payment (a 'cod' order is paid after the delivery), no cancelling
  -- after production started.
  if p_status = 'cancelled' then
    if v_order.status not in ('new', 'confirmed') then
      raise exception 'too_late_to_cancel';
    end if;
    -- money is the owner's: a paid order ends with a refund (set_payment_status),
    -- one the customer says is paid waits for the owner to check the account
    if v_order.payment_status = 'paid' then
      raise exception 'refund_instead';
    end if;
    if v_order.payment_status = 'awaiting_verification' and not public.is_admin(array['owner']) then
      raise exception 'owner_only';
    end if;
  else
    -- a failed delivery is recorded with its reason (record_delivery_failure), then tried
    -- again or comes back
    if p_status = 'delivery_failed' then
      raise exception 'reason_required';
    end if;
    if not coalesce(case v_order.status
          when 'new' then p_status = 'confirmed'
          when 'confirmed' then p_status = 'in_production'
          when 'in_production' then p_status = 'shipped'
          when 'shipped' then p_status = 'delivered'
          when 'delivery_failed' then p_status in ('shipped', 'returned') end, false) then
      raise exception 'not_next';
    end if;
    if p_status in ('in_production', 'shipped', 'delivered') and v_order.payment_status <> 'paid'
       and v_order.payment_method <> 'cod' then
      raise exception 'needs_payment';
    end if;
  end if;

  -- Cancelling gives the reserved coffee back, exactly once.
  if p_status = 'cancelled' and not v_order.stock_returned then
    perform set_config('boga.stock_write', 'on', true);
    for d in select value from jsonb_array_elements(v_order.stock_deductions) order by value ->> 'originId' loop
      update public.origins set stock_kg = stock_kg + (d ->> 'kg')::numeric where id = d ->> 'originId';
      insert into public.stock_movements (origin_id, delta_kg, reason, ref, actor)
      values (d ->> 'originId', (d ->> 'kg')::numeric, 'order_cancelled', v_order.number, auth.uid());
    end loop;
    update public.orders set stock_returned = true where id = p_order_id;
    perform set_config('boga.stock_write', '', true);
  end if;

  update public.orders set status = p_status where id = p_order_id;
  insert into public.order_events (order_id, label, actor) values (p_order_id, 'status.' || p_status, auth.uid());
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
       and o.payment_method <> 'cod'
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

commit;

select count(*) as restored from pg_proc
 where pronamespace = 'public'::regnamespace
   and md5(replace(prosrc, E'\r', '')) in ('b58ddc10a13a44a147a1002a40709273', '70f00d178f8af4514c213fd63de4cfb3');
