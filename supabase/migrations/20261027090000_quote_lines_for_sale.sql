-- A B2B request refuses a product that is not for sale (P5.2, risk R20 of docs/12-audit-and-launch-plan.md).
--
-- commit_quote_request (20261016120000_catalog_ready.sql) checked the sales gate but not its lines: with the sales
-- open it accepted a line of a hidden, listed-only or unknown product. Only service_role can call it and the storefront
-- function drops such lines before (src/core/requests.ts), so no visitor had a way in; this makes the database refuse
-- it too, as commit_order does ('invalid_order:product'). A line that is not an object is refused ('invalid_quote:lines'),
-- 'invalid_quote:product' for any line that is not a Custom Blend and names a product not for sale (a line with no kind counts as a product line). Custom Blend lines and the rest of the body are unchanged.
--
-- No table, grant or row changes: the function is replaced in place (its execute grant stays service_role only).
-- Rollback: supabase/manual/20261027090000_quote_lines_for_sale.rollback.sql (puts the previous body back; SQL Editor).

create or replace function public.commit_quote_request(p_quote jsonb, p_whatsapp text, p_email text, p_subject text)
returns table (id uuid, number text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id     uuid := gen_random_uuid();
  v_seq    bigint;
  v_number text;
begin
  -- the sales gate, as in commit_order: under a lock on the settings row, before a number is taken
  perform 1 from public.site_config c where c.id = 1 and c.settings -> 'salesOpen' = 'true'::jsonb for share;
  if not found then
    raise exception 'sales_closed';
  end if;
  v_seq := nextval('public.quote_number_seq');
  v_number := 'QR-' || to_char(now(), 'YYYY') || '-' || lpad(v_seq::text, greatest(4, length(v_seq::text)), '0');
  if jsonb_typeof(p_quote -> 'lines') is distinct from 'array' or jsonb_array_length(p_quote -> 'lines') = 0 then
    raise exception 'invalid_quote:lines';
  end if;
  -- R20: a line is an object, and every line that is not a Custom Blend names a product that is for sale (shown: active), the
  -- rule commit_order applies; a hidden, listed-only or unknown product is never requested, whoever calls this function,
  -- and a line with no kind (or an odd one) is checked as a product line
  if exists (select 1 from jsonb_array_elements(p_quote -> 'lines') l where jsonb_typeof(l) is distinct from 'object') then
    raise exception 'invalid_quote:lines';
  end if;
  if exists (select 1 from jsonb_array_elements(p_quote -> 'lines') l
              where l ->> 'kind' is distinct from 'custom'
                and not exists (select 1 from public.products p where p.id = l ->> 'productId' and p.active)) then
    raise exception 'invalid_quote:product';
  end if;
  insert into public.quote_requests (
    id, number, business_type, company, contact_name, phone, email, city_id, lines, weight_kg, indicative_total, notes
  ) values (
    v_id, v_number,
    p_quote ->> 'businessType',
    coalesce(p_quote ->> 'company', ''),
    p_quote ->> 'contactName',
    p_quote ->> 'phone',
    coalesce(p_quote ->> 'email', ''),
    p_quote ->> 'cityId',
    p_quote -> 'lines',
    (p_quote ->> 'weightKg')::numeric,
    (p_quote ->> 'indicativeTotal')::numeric,
    coalesce(p_quote ->> 'notes', '')
  );
  perform public.queue_notification('quote.created', replace(p_subject, '{number}', v_number),
                                    replace(p_whatsapp, '{number}', v_number), replace(p_email, '{number}', v_number));
  return query select v_id, v_number;
end $$;
