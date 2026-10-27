-- Rollback of 20261027090000_quote_lines_for_sale: the body of commit_quote_request from 20261016120000_catalog_ready.sql.
-- Run in the SQL Editor, only with the owner's approval. The execute grant (service_role only) is not touched.

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
