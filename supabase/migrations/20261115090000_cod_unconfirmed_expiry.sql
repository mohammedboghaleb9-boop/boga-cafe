-- Cash on delivery, two owner decisions of 2026-11-14 (after 20261110120000_cod):
-- 1. A 'cod' order still 'new' 24 hours after it was placed (nobody confirmed it by phone) expires like an unpaid
--    prepaid order: cancelled, its stock given back once (stock_returned), a stock movement 'order_cancelled' (note
--    'auto') and the event 'status.expired'. A 'confirmed' cod order never expires. The 24 hours are fixed here,
--    not a setting. The schedule is the existing 'expire-unpaid-orders' job (every 15 minutes, 20261001180333).
-- 2. Only the owner marks a 'cod' order 'delivered' (refusal 'owner_only'). A prepaid order keeps its rule.
-- Nothing else changes: the prepaid expiry and every other transition are 20261110120000_cod's, word for word.
-- Both functions also get pg_temp last in their search_path, like the newer functions.
--
-- Guards: each function is replaced only if its body is the one this file was written from, or this file's own.
-- No row changes. Rollback: supabase/manual/20261115090000_cod_unconfirmed_expiry.rollback.sql.

do $$
declare
  v_known constant jsonb := '{
    "set_order_status":     ["b58ddc10a13a44a147a1002a40709273", "7a7ea43dda1387a5616d9ced6e8aad1f"],
    "expire_unpaid_orders": ["70f00d178f8af4514c213fd63de4cfb3", "28f43ad74e38f0f292344a8f5e56517a"]
  }';
  v_name text;
begin
  for v_name in select jsonb_object_keys(v_known) loop
    if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = v_name) <> 1
       or not v_known -> v_name ? (select md5(replace(prosrc, E'\r', '')) from pg_proc
                                    where pronamespace = 'public'::regnamespace and proname = v_name) then
      raise exception 'stop: % on this database is not the one this migration was written from: tell Claude before going on', v_name;
    end if;
  end loop;
end $$;

-- set_order_status (20261110120000_cod.sql) with the owner-only delivery of a 'cod' order.
create or replace function public.set_order_status(p_order_id uuid, p_status text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
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
    -- a 'cod' order is marked delivered by the owner alone (owner, 2026-11-14): what follows is the money's
    -- (set_payment_status, also the owner's). A prepaid order keeps init's rule: any admin.
    if p_status = 'delivered' and v_order.payment_method = 'cod' and not public.is_admin(array['owner']) then
      raise exception 'owner_only';
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

-- expire_unpaid_orders (20261110120000_cod.sql) with the 24-hour end of an unconfirmed 'cod' order.
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
       and ((o.payment_method <> 'cod'
             and ((o.payment_status in ('pending', 'failed') and o.created_at < now() - make_interval(secs => v_hours * 3600))
               or (o.payment_status = 'awaiting_verification' and o.created_at < now() - make_interval(secs => v_check * 3600))))
         -- a 'cod' order nobody confirmed 24 hours after it was placed (fixed, owner 2026-11-14); once confirmed it
         -- never expires
         or (o.payment_method = 'cod' and o.status = 'new' and o.created_at <= now() - interval '24 hours'))
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

-- ───────────── Rights ─────────────
-- create or replace keeps them; written again so the file states them (as 20260927000000_init.sql and
-- 20261019200936_expiry_lock_order.sql set them)
revoke all on function public.set_order_status(uuid, text) from public, anon;
grant execute on function public.set_order_status(uuid, text) to authenticated;
revoke all on function public.expire_unpaid_orders() from public, anon, authenticated;
grant execute on function public.expire_unpaid_orders() to service_role;
