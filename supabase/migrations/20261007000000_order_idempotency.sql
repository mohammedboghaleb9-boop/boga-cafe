-- P5 step 3, slice 3b: an order sent again after a lost answer gives back the first
-- order instead of saving a second one. The site sends one random key (uuid) per
-- submission, and the same key when the customer sends the same submission again.
-- No key = no check, as before. B2B requests have no key yet (they reserve no stock).

alter table public.orders add column idempotency_key uuid;
alter table public.orders add constraint orders_idempotency_key_key unique (idempotency_key);

-- a new argument and a new result column: replaced, not overloaded (one function, one grant)
drop function public.commit_order(jsonb, text, text, text);

create function public.commit_order(p_order jsonb, p_whatsapp text, p_email text, p_subject text,
                                    p_idempotency_key uuid default null)
returns table (id uuid, number text, created boolean)
language plpgsql security definer set search_path = public as $$
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

    insert into public.order_events (order_id, label) values (v_id, 'order.created');
    perform public.queue_notification('order.created', replace(p_subject, '{number}', v_number),
                                      replace(p_whatsapp, '{number}', v_number), replace(p_email, '{number}', v_number));
    perform set_config('boga.stock_write', '', true);
  exception when unique_violation then
    -- the same key sent twice at the same moment: this one waited for the other to
    -- commit; everything it did in this block (stock, movements, messages) is undone
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint is distinct from 'orders_idempotency_key_key' then
      raise;
    end if;
    return query select o.id, o.number, false from public.orders o where o.idempotency_key = p_idempotency_key;
    return;
  end;
  return query select v_id, v_number, true;
end $$;

revoke all on function public.commit_order(jsonb, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.commit_order(jsonb, text, text, text, uuid) to service_role;
