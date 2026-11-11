-- ROLLBACK of 20261110120000_cod: the five functions as they were before, record_delivery_failure, the two
-- columns, the two statuses, the 'collected' payment status and the 'cod' method go.
-- Supabase SQL Editor (it holds DROPs), ONE transaction, only with the owner's approval.
-- It stops ("stop:", nothing changed) if a function is not the one of 20261110120000_cod (never a hand change
-- overwritten unseen), or if ANY order would lose something: an order paid on delivery, a failed or returned
-- delivery, a collected payment, a backup phone or a failure reason. Once such an order exists this rollback is not
-- the answer: tell Claude.
-- NOT restored: card, Cash Plus and transfer stay switched off (the migration did not record how they were); the
-- owner switches them back on in the Admin Panel (Payments).
-- BEFORE: put back a site that sends no 'cod' order, or its checkout is refused (invalid_order:payment_method).
-- RESULT: the last select reads restored 5, cod_method 0, new_columns 0, new_function 0.
-- AFTER: remove the history row of 20261110120000 (a separate step).
-- Tests: tests/manual-sql.test.ts keeps each restored function equal to its migration's.

begin;
set local lock_timeout = '3s';
-- no order is saved between the check below and the drops (a backup phone would be lost unseen)
lock table public.orders in share row exclusive mode;

do $$
begin
  if (select md5(replace(prosrc, E'\r', '')) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'commit_order')
       is distinct from '1e7874abc49a04174545bb7df8a273ce' then
    raise exception 'stop: commit_order is not the one of 20261110120000_cod: tell Claude before going on';
  end if;
  if (select md5(replace(prosrc, E'\r', '')) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'set_order_status')
       is distinct from 'b58ddc10a13a44a147a1002a40709273' then
    raise exception 'stop: set_order_status is not the one of 20261110120000_cod: tell Claude before going on';
  end if;
  if (select md5(replace(prosrc, E'\r', '')) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'set_payment_status')
       is distinct from 'a5b4c4dc5946465a6da6fc73918833af' then
    raise exception 'stop: set_payment_status is not the one of 20261110120000_cod: tell Claude before going on';
  end if;
  if (select md5(replace(prosrc, E'\r', '')) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'expire_unpaid_orders')
       is distinct from '70f00d178f8af4514c213fd63de4cfb3' then
    raise exception 'stop: expire_unpaid_orders is not the one of 20261110120000_cod: tell Claude before going on';
  end if;
  if (select md5(replace(prosrc, E'\r', '')) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'report_offline_payment')
       is distinct from 'e84409c2a6e1e9d8a3ed1b765ffd2b8e' then
    raise exception 'stop: report_offline_payment is not the one of 20261110120000_cod: tell Claude before going on';
  end if;
  if exists (select 1 from public.orders
              where payment_method = 'cod' or status in ('delivery_failed', 'returned') or payment_status = 'collected'
                 or phone_alt <> '' or failure_reason <> '') then
    raise exception 'stop: an order uses what this rollback removes (cod, a failed or returned delivery, a collected payment, a backup phone or a failure reason): tell Claude';
  end if;
end $$;

-- >>> commit_order of 20261016120000_catalog_ready.sql
create or replace function public.commit_order(p_order jsonb, p_whatsapp text, p_email text, p_subject text,
                                    p_idempotency_key uuid default null)
returns table (id uuid, number text, created boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  d          jsonb;
  v_checked  jsonb;
  v_deductions jsonb;
  v_origin   public.origins;
  v_id       uuid := gen_random_uuid();
  v_seq      bigint;
  v_number   text;
  v_constraint text;
begin
  -- the same submission again: the order it saved, untouched (no new check, stock or message)
  if p_idempotency_key is not null then
    return query select o.id, o.number, false from public.orders o where o.idempotency_key = p_idempotency_key;
    if found then
      return;
    end if;
  end if;
  -- the sales gate, under a lock on the settings row: set_sales_open waits for this sale to end,
  -- and no number is taken by a refused order
  perform 1 from public.site_config c where c.id = 1 and c.settings -> 'salesOpen' = 'true'::jsonb for share;
  if not found then
    raise exception 'sales_closed';
  end if;
  v_seq := nextval('public.order_number_seq');
  -- lpad would cut 10000 to '1000': pad to 4 digits, never shorten
  v_number := 'BC-' || to_char(now(), 'YYYY') || '-' || lpad(v_seq::text, greatest(4, length(v_seq::text)), '0');
  -- refuse anything that could add stock or be free before looking further
  if jsonb_typeof(p_order -> 'stockDeductions') is distinct from 'array'
     or jsonb_array_length(p_order -> 'stockDeductions') = 0
     or exists (select 1 from jsonb_array_elements(p_order -> 'stockDeductions') x
                where coalesce((x ->> 'kg')::numeric, 0) <= 0
                   or (x ->> 'kg')::numeric in ('NaN', 'Infinity')) then
    raise exception 'invalid_order';
  end if;
  -- everything else in the order is checked against the database; what is stored below
  -- (customer, lines, deductions) is what check_order rebuilt from it
  v_checked := public.check_order(p_order);
  v_deductions := v_checked -> 'stockDeductions';
  begin
    -- the order row first: a second call with the same key waits here until the first
    -- one ends, then lands in the handler below, before it could find the stock gone
    insert into public.orders (
      id, number, locale, customer_name, phone, email, city_id, address, company, notes,
      lines, weight_kg, subtotal, shipping_fee, total, payment_method, stock_deductions, idempotency_key
    ) values (
      v_id, v_number,
      coalesce(p_order ->> 'locale', 'fr'),
      v_checked #>> '{customer,fullName}',
      v_checked #>> '{customer,phone}',
      v_checked #>> '{customer,email}',
      p_order #>> '{customer,cityId}',
      v_checked #>> '{customer,address}',
      coalesce(p_order #>> '{customer,company}', ''),
      coalesce(p_order #>> '{customer,notes}', ''),
      v_checked -> 'lines',
      (p_order ->> 'weightKg')::numeric,
      (p_order ->> 'subtotal')::numeric,
      (p_order ->> 'shippingFee')::numeric,
      (p_order ->> 'total')::numeric,
      p_order ->> 'paymentMethod',
      v_deductions,
      p_idempotency_key
    );

    perform set_config('boga.stock_write', 'on', true);
    -- Lock every origin used, in a fixed order to avoid deadlocks.
    for d in
      select value from jsonb_array_elements(v_deductions) order by value ->> 'originId'
    loop
      select * into v_origin from public.origins o where o.id = d ->> 'originId' for update;
      if not found or not v_origin.active then
        raise exception 'out_of_stock:%', d ->> 'originId';
      end if;
      if v_origin.stock_kg < (d ->> 'kg')::numeric then
        raise exception 'out_of_stock:%', d ->> 'originId';
      end if;
      update public.origins o set stock_kg = o.stock_kg - (d ->> 'kg')::numeric where o.id = v_origin.id;
      insert into public.stock_movements (origin_id, delta_kg, reason, ref)
      values (v_origin.id, -((d ->> 'kg')::numeric), 'order', v_number);
    end loop;

    insert into public.order_events (order_id, label) values (v_id, 'order.created');
    perform public.queue_notification('order.created', replace(p_subject, '{number}', v_number),
                                      replace(p_whatsapp, '{number}', v_number), replace(p_email, '{number}', v_number));
    perform set_config('boga.stock_write', '', true);
  exception when unique_violation then
    -- the same key sent twice at the same moment: this one waited for the other to
    -- commit; nothing it did in this block is kept
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint is distinct from 'orders_idempotency_key_key' then
      raise;
    end if;
    return query select o.id, o.number, false from public.orders o where o.idempotency_key = p_idempotency_key;
    return;
  end;
  return query select v_id, v_number, true;
end $$;
-- <<< commit_order

-- >>> set_order_status of 20260927000000_init.sql
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
  if v_order.status in ('cancelled', 'delivered') then
    raise exception 'closed';
  end if;
  -- Same rules as src/core/orderFlow.ts: one step at a time, nothing produced
  -- or shipped before payment (no cash on delivery), no cancelling after production started.
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
    if p_status is distinct from (case v_order.status
          when 'new' then 'confirmed' when 'confirmed' then 'in_production'
          when 'in_production' then 'shipped' when 'shipped' then 'delivered' end) then
      raise exception 'not_next';
    end if;
    if p_status in ('in_production', 'shipped', 'delivered') and v_order.payment_status <> 'paid' then
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
-- <<< set_order_status

-- >>> set_payment_status of 20260927000000_init.sql
create or replace function public.set_payment_status(p_order_id uuid, p_status text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_order public.orders;
begin
  -- money is the owner's decision (src/core/orderFlow.ts canSetPayment)
  if not public.is_admin(array['owner']) then
    raise exception 'forbidden';
  end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_order.status = 'cancelled' and p_status <> 'refunded' then
    raise exception 'closed';
  end if;
  if not coalesce(case p_status
        when 'paid' then v_order.payment_status in ('pending', 'awaiting_verification', 'failed')
        when 'failed' then v_order.payment_status in ('pending', 'awaiting_verification')
        -- same as src/core/orderFlow.ts: never mid-production; late money on a cancelled order can be refunded
        when 'refunded' then v_order.status in ('new', 'confirmed', 'cancelled', 'delivered')
                             and (v_order.payment_status = 'paid'
                                  or (v_order.status = 'cancelled' and v_order.payment_status <> 'refunded'))
        when 'pending' then v_order.payment_status in ('awaiting_verification', 'failed')
        when 'awaiting_verification' then v_order.payment_status in ('pending', 'failed')
      end, false) then
    raise exception 'invalid_transition';
  end if;
  update public.orders
     set payment_status = p_status,
         status = case when p_status = 'paid' and status = 'new' then 'confirmed' else status end
   where id = p_order_id;
  insert into public.order_events (order_id, label, actor) values (p_order_id, 'payment.' || p_status, auth.uid());
  -- a refund before production ends the order: cancelled, coffee back to stock
  -- (src/core/orderFlow.ts refundCancelsOrder)
  if p_status = 'refunded' and v_order.status in ('new', 'confirmed') then
    perform public.set_order_status(p_order_id, 'cancelled');
  end if;
end $$;
-- <<< set_payment_status

-- >>> expire_unpaid_orders of 20261019200936_expiry_lock_order.sql
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
-- <<< expire_unpaid_orders

-- >>> report_offline_payment of 20260927000000_init.sql
create or replace function public.report_offline_payment(p_order_id uuid, p_ref text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_order  public.orders;
  v_method text;
  v_body   text;
begin
  update public.orders
     set payment_status = 'awaiting_verification', payment_ref = left(p_ref, 80)
   where id = p_order_id and payment_status in ('pending', 'failed') and payment_method <> 'card'
     and status in ('new', 'confirmed')
  returning * into v_order;
  if not found then
    return;
  end if;
  insert into public.order_events (order_id, label) values (p_order_id, 'payment.reported');
  -- the team is told, like for a new order (same first line as
  -- src/services/notifications/templates.ts paymentReportMessage)
  select coalesce(label ->> 'fr', id) into v_method from public.payment_methods where id = v_order.payment_method;
  v_body := concat_ws(E'\n',
    'Paiement signalé ' || v_order.number,
    'Moyen : ' || coalesce(v_method, v_order.payment_method),
    'Montant attendu : ' || v_order.total || ' DH',
    'Référence donnée par le client : ' || v_order.payment_ref,
    'À vérifier sur le compte avant de préparer la commande.',
    'Client : ' || v_order.customer_name || ' (' || v_order.phone || ')',
    'Adresse : ' || v_order.address);
  perform public.queue_notification('payment.reported',
    '[BOGA CAFÉ] Paiement signalé ' || v_order.number || ' - ' || v_order.total || ' DH', v_body, v_body);
end $$;
-- <<< report_offline_payment

drop function public.record_delivery_failure(uuid, text);

delete from public.payment_methods where id = 'cod';
alter table public.payment_methods drop constraint payment_methods_id_check;
alter table public.payment_methods add constraint payment_methods_id_check check (id in ('card', 'cashplus', 'bank_transfer'));

alter table public.orders drop constraint orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status in ('new', 'confirmed', 'in_production', 'shipped', 'delivered', 'cancelled'));
alter table public.orders drop constraint orders_payment_status_check;
alter table public.orders add constraint orders_payment_status_check
  check (payment_status in ('pending', 'awaiting_verification', 'paid', 'failed', 'refunded'));
alter table public.orders drop column phone_alt;
alter table public.orders drop column failure_reason;

commit;

select
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
     and (proname, md5(replace(prosrc, E'\r', ''))) in (('commit_order', '470f0947d3666b6c6ab3ecaaafe4d1c4'), ('set_order_status', '4f5da4f350ab5549ff06a9365e76ae92'), ('set_payment_status', '116a3939f5c50f40431a46641b586d38'), ('expire_unpaid_orders', '6314ee398d46b45d0534dbe79d1b6091'), ('report_offline_payment', '78f0bfe6938a111f66438115da30f9a5'))) as restored,
  (select count(*) from public.payment_methods where id = 'cod') as cod_method,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'orders'
                                                     and column_name in ('phone_alt', 'failure_reason')) as new_columns,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'record_delivery_failure') as new_function;
