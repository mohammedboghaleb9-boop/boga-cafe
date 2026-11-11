-- Cash on delivery (COD): the customer pays the carrier at the door, so the money comes after the delivery.
--
-- What changes, and only this:
-- 1. A fourth payment method, 'cod'. The three prepaid ones (card, Cash Plus, transfer) are switched off (owner,
--    2026-11-10: COD is the only method at launch); the owner switches one back on in the Admin Panel.
-- 2. orders.phone_alt (a second number for the carrier) and orders.failure_reason (why a delivery failed).
-- 3. Two more order statuses, 'delivery_failed' and 'returned', and one more payment status, 'collected' (the
--    carrier holds the money). Delivery, the carrier's collection and BOGA's receipt stay three separate facts:
--    status = 'delivered', payment_status = 'collected', payment_status = 'paid'.
-- 4. For a 'cod' order only: no "paid before preparing" rule, no automatic expiry, no "I have paid" report by the
--    customer. A prepaid order keeps every rule it had.
-- 5. The stock is untouched: deducted at the order, given back by a cancellation or an expiry, as before. A failed
--    or returned delivery gives nothing back by itself (owner, 2026-11-10): the owner corrects the stock by hand
--    (adjust_stock) when the bags are back and sellable.
--
-- Guards: each function is replaced only if its body is the one this file was written from, or this file's own.
-- Rollback: supabase/manual/20261110120000_cod.rollback.sql.

do $$
declare
  v_known constant jsonb := '{
    "commit_order":           ["470f0947d3666b6c6ab3ecaaafe4d1c4", "1e7874abc49a04174545bb7df8a273ce"],
    "set_order_status":       ["4f5da4f350ab5549ff06a9365e76ae92", "b58ddc10a13a44a147a1002a40709273"],
    "set_payment_status":     ["116a3939f5c50f40431a46641b586d38", "a5b4c4dc5946465a6da6fc73918833af"],
    "expire_unpaid_orders":   ["6314ee398d46b45d0534dbe79d1b6091", "70f00d178f8af4514c213fd63de4cfb3"],
    "report_offline_payment": ["78f0bfe6938a111f66438115da30f9a5", "e84409c2a6e1e9d8a3ed1b765ffd2b8e"]
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

-- ───────────── Tables ─────────────

alter table public.payment_methods drop constraint payment_methods_id_check;
alter table public.payment_methods add constraint payment_methods_id_check
  check (id in ('card', 'cashplus', 'bank_transfer', 'cod'));

alter table public.orders add column if not exists phone_alt text not null default '' check (char_length(phone_alt) <= 24);
alter table public.orders add column if not exists failure_reason text not null default '' check (char_length(failure_reason) <= 200);

alter table public.orders drop constraint orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status in ('new', 'confirmed', 'in_production', 'shipped', 'delivered', 'cancelled', 'delivery_failed', 'returned'));
alter table public.orders drop constraint orders_payment_status_check;
alter table public.orders add constraint orders_payment_status_check
  check (payment_status in ('pending', 'awaiting_verification', 'collected', 'paid', 'failed', 'refunded'));

-- ───────────── The method ─────────────

insert into public.payment_methods (id, enabled, label, instructions) values (
  'cod', true,
  '{"ar": "الدفع عند الاستلام", "fr": "Paiement à la livraison", "en": "Cash on delivery"}',
  '{"ar": "تدفعون نقداً للموزّع عند استلام الطلب. نتصل بكم لتأكيد الطلب قبل الإرسال.",
    "fr": "Vous payez en espèces au livreur à la réception. Nous vous appelons pour confirmer la commande avant l''envoi.",
    "en": "You pay the courier in cash on delivery. We call you to confirm the order before it is sent."}'
) on conflict (id) do nothing;
update public.payment_methods set enabled = false where id in ('card', 'cashplus', 'bank_transfer') and enabled;

-- ───────────── Functions ─────────────

-- commit_order (20261016120000_catalog_ready.sql) with the backup phone: required, checked and stored like the
-- first one. Nothing else differs.
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
  v_phone_alt text;
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
  -- the backup phone: the same rule and the same stored form as the first one
  -- (check_order above it, src/core/validation.ts normalizePhone)
  v_phone_alt := regexp_replace(coalesce(p_order #>> '{customer,phoneAlt}', ''),
                                '[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff.\-()]', '', 'g');
  if v_phone_alt !~ '^(\+212|00212|0)[5-7][0-9]{8}$' then
    raise exception 'invalid_order:phone_alt';
  end if;
  v_phone_alt := '+212' || right(v_phone_alt, 9);
  begin
    -- the order row first: a second call with the same key waits here until the first
    -- one ends, then lands in the handler below, before it could find the stock gone
    insert into public.orders (
      id, number, locale, customer_name, phone, phone_alt, email, city_id, address, company, notes,
      lines, weight_kg, subtotal, shipping_fee, total, payment_method, stock_deductions, idempotency_key
    ) values (
      v_id, v_number,
      coalesce(p_order ->> 'locale', 'fr'),
      v_checked #>> '{customer,fullName}',
      v_checked #>> '{customer,phone}',
      v_phone_alt,
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

-- set_order_status (20260927000000_init.sql) with:
--   · a 'cod' order is prepared, shipped and delivered unpaid (the money comes after);
--   · a failed delivery is tried again (back to 'shipped') or comes back ('returned', closed);
--   · 'delivery_failed' itself is set by record_delivery_failure, which wants the reason.
-- The cancellation and its stock are init's, unchanged.
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

-- A cash on delivery order whose delivery failed (the customer refused, was absent, ...): the reason is kept on the
-- order. Any admin, like the other delivery steps. The stock does not move. A prepaid order never takes this path:
-- its money is BOGA's already and its refund rules (set_payment_status) know nothing of a failed delivery.
create or replace function public.record_delivery_failure(p_order_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_order  public.orders;
  v_reason text := btrim(regexp_replace(coalesce(p_reason, ''), '[[:space:]]+', ' ', 'g'));
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_order.status <> 'shipped' or v_order.payment_method <> 'cod' then
    raise exception 'not_next';
  end if;
  if char_length(v_reason) not between 3 and 200 then
    raise exception 'invalid_reason';
  end if;
  update public.orders set status = 'delivery_failed', failure_reason = v_reason where id = p_order_id;
  insert into public.order_events (order_id, label, actor) values (p_order_id, 'status.delivery_failed', auth.uid());
end $$;

-- set_payment_status (20260927000000_init.sql) with the money of a 'cod' order, the owner's alone like every
-- payment: delivered -> 'collected' (the carrier holds it) -> 'paid' (BOGA received it, checked by the owner);
-- 'collected' can be taken back to 'pending' (a wrong click); a refund only of money BOGA received.
-- A prepaid order keeps init's rules and never takes 'collected'.
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
  -- a 'cod' order is paid after the delivery: delivered -> 'collected' (the carrier holds the
  -- money) -> 'paid' (BOGA received it); 'collected' can be taken back (a wrong click); a refund
  -- only of money BOGA received (src/core/orderFlow.ts canSetPayment)
  if v_order.payment_method = 'cod' then
    if not coalesce(case p_status
          when 'collected' then v_order.status = 'delivered' and v_order.payment_status = 'pending'
          when 'paid' then v_order.payment_status = 'collected'
          when 'pending' then v_order.payment_status = 'collected'
          when 'refunded' then v_order.payment_status = 'paid'
        end, false) then
      raise exception 'invalid_transition';
    end if;
  elsif not coalesce(case p_status
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

-- expire_unpaid_orders (20261019200936_expiry_lock_order.sql): a 'cod' order is unpaid by design until it is
-- delivered, so it never expires. Nothing else differs.
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

-- report_offline_payment (20260927000000_init.sql): a 'cod' order has nothing to report, the customer pays the
-- carrier. Nothing else differs.
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
   where id = p_order_id and payment_status in ('pending', 'failed') and payment_method not in ('card', 'cod')
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

-- ───────────── Rights ─────────────
-- the replaced functions keep theirs; the new one is the admins', through the API, like set_order_status
revoke all on function public.record_delivery_failure(uuid, text) from public, anon;
grant execute on function public.record_delivery_failure(uuid, text) to authenticated;
