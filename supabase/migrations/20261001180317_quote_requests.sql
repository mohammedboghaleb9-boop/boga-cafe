-- ───────────── B2B requests (cart above the threshold) ─────────────
-- Written by the server only (Edge Function "storefront", secret key), which
-- builds the request with src/core. Saved, numbered and notified in one transaction.
-- Numbered like commit_order: at least 4 digits, never cut.
create or replace function public.commit_quote_request(p_quote jsonb, p_whatsapp text, p_email text, p_subject text)
returns table (id uuid, number text)
language plpgsql security definer set search_path = public as $$
declare
  v_id     uuid := gen_random_uuid();
  v_seq    bigint := nextval('public.quote_number_seq');
  v_number text := 'QR-' || to_char(now(), 'YYYY') || '-' || lpad(v_seq::text, greatest(4, length(v_seq::text)), '0');
begin
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

revoke all on function public.commit_quote_request(jsonb, text, text, text) from public, anon, authenticated;
grant execute on function public.commit_quote_request(jsonb, text, text, text) to service_role;
