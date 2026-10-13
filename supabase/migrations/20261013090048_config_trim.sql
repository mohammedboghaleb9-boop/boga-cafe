-- Texts are saved without the spaces and line breaks at their start and end (P5 slice 11).
--
-- Found on the live site (the owner's preview test of slice 10, 2026-10-12): save_content kept what
-- the form sent, so a hero title edited and put back ended with a space, and an announcement
-- started with two. save_payee already trims; the other texts saved by slice 10 did not. Now
-- save_content (texts and contact details), save_recipients (WhatsApp number, email),
-- save_payment_method (label, instructions) and save_shipping_rate (city, delivery days) trim every
-- text they receive BEFORE checking its length, its format or its French part, so a limit counts
-- what is kept and a pasted link with a trailing space is a link. Inside a text nothing changes
-- (a line break in the middle of the about text stays).
-- Only a space, a tab, a carriage return and a line feed are trimmed (btrim alone trims spaces only).
--
-- create or replace keeps each function's owner and grants. No DELETE and no DROP here: the tool
-- that applies migrations to the live project hangs on them. Rollback: the four bodies of
-- 20261012183912_settings_writes.sql, then drop the two helpers (SQL Editor).

-- A JSON string without the spaces and line breaks at its start and end; anything else as it is.
create or replace function public.config_trim_str(p_value jsonb) returns jsonb
language sql immutable set search_path = public, pg_temp as $$
  select case when jsonb_typeof(p_value) = 'string' then to_jsonb(btrim(p_value #>> '{}', E' \t\r\n')) else p_value end
$$;

-- A text in three languages ({"ar": …, "fr": …, "en": …}) with each string trimmed; anything else as it is.
create or replace function public.config_trim_text(p_value jsonb) returns jsonb
language sql immutable set search_path = public, pg_temp as $$
  select case when jsonb_typeof(p_value) = 'object'
              then (select coalesce(jsonb_object_agg(e.key, public.config_trim_str(e.value)), '{}'::jsonb) from jsonb_each(p_value) e)
              else p_value end
$$;

revoke all on function public.config_trim_str(jsonb) from public, anon, authenticated;
revoke all on function public.config_trim_text(jsonb) from public, anon, authenticated;

-- p_content: src/core/types.ts SiteContent (owner and manager); p_contact: Settings.contact,
-- the owner's, or null to leave it as it is. Saved together, or not at all.
create or replace function public.save_content(p_content jsonb, p_contact jsonb, p_seen_content text, p_seen_contact text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin(array['owner', 'manager']) then
    raise exception 'forbidden';
  end if;
  if p_contact is not null and not public.is_admin(array['owner']) then
    raise exception 'owner_only';
  end if;
  -- no text keeps a space or a line break at its start or end: trimmed here, before it is checked and stored
  p_content := jsonb_build_object('announcement', public.config_trim_text(p_content -> 'announcement'),
                                  'heroTitle', public.config_trim_text(p_content -> 'heroTitle'),
                                  'heroSubtitle', public.config_trim_text(p_content -> 'heroSubtitle'),
                                  'aboutTitle', public.config_trim_text(p_content -> 'aboutTitle'),
                                  'aboutText', public.config_trim_text(p_content -> 'aboutText'));
  if p_contact is not null then
    p_contact := jsonb_build_object('whatsapp', public.config_trim_str(p_contact -> 'whatsapp'), 'email', public.config_trim_str(p_contact -> 'email'),
                                    'instagram', public.config_trim_str(p_contact -> 'instagram'), 'tiktok', public.config_trim_str(p_contact -> 'tiktok'),
                                    'facebook', public.config_trim_str(p_contact -> 'facebook'), 'address', public.config_trim_text(p_contact -> 'address'),
                                    'hours', public.config_trim_text(p_contact -> 'hours'));
  end if;
  if not (public.config_text_ok(p_content -> 'announcement', 200)
          and public.config_text_ok(p_content -> 'heroTitle', 120)
          and public.config_text_ok(p_content -> 'heroSubtitle', 400)
          and public.config_text_ok(p_content -> 'aboutTitle', 120)
          and public.config_text_ok(p_content -> 'aboutText', 2000)) then
    raise exception 'invalid_content';
  end if;
  if p_contact is not null
     and not (public.config_string_ok(p_contact -> 'whatsapp', 16, '^\+?[0-9]{8,15}$')
              and public.config_string_ok(p_contact -> 'email', 120, '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
              and public.config_string_ok(p_contact -> 'instagram', 200, '^https://[^[:space:]]+$')
              and public.config_string_ok(p_contact -> 'tiktok', 200, '^https://[^[:space:]]+$')
              and public.config_string_ok(p_contact -> 'facebook', 200, '^https://[^[:space:]]+$')
              and public.config_text_ok(p_contact -> 'address', 200)
              and public.config_text_ok(p_contact -> 'hours', 200)) then
    raise exception 'invalid_contact';
  end if;
  perform public.config_section_seen('content', p_seen_content);
  if p_contact is not null then
    perform public.config_section_seen('contact', p_seen_contact);
  end if;
  update public.site_config
     set content = jsonb_build_object('announcement', p_content -> 'announcement', 'heroTitle', p_content -> 'heroTitle',
                                      'heroSubtitle', p_content -> 'heroSubtitle', 'aboutTitle', p_content -> 'aboutTitle',
                                      'aboutText', p_content -> 'aboutText'),
         settings = case when p_contact is null then settings
                         else settings || jsonb_build_object('contact', jsonb_build_object(
                                'whatsapp', p_contact -> 'whatsapp', 'email', p_contact -> 'email', 'instagram', p_contact -> 'instagram',
                                'tiktok', p_contact -> 'tiktok', 'facebook', p_contact -> 'facebook', 'address', p_contact -> 'address',
                                'hours', p_contact -> 'hours')) end,
         versions = versions || jsonb_build_object('content', clock_timestamp()::text)
                    || case when p_contact is null then '{}'::jsonb else jsonb_build_object('contact', clock_timestamp()::text) end
   where id = 1;
  perform public.config_saved('content');
  if p_contact is not null then
    perform public.config_saved('contact');
  end if;
end $$;

-- Who receives the team's messages (admin_config): the owner's. p_seen: its updated_at as read.
create or replace function public.save_recipients(p_recipients jsonb, p_seen timestamptz) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin(array['owner']) then
    raise exception 'forbidden';
  end if;
  p_recipients := p_recipients || jsonb_build_object('adminWhatsapp', public.config_trim_str(p_recipients -> 'adminWhatsapp'),
                                                     'adminEmail', public.config_trim_str(p_recipients -> 'adminEmail'));
  if not (public.config_string_ok(p_recipients -> 'adminWhatsapp', 16, '^\+?[0-9]{8,15}$')
          and public.config_string_ok(p_recipients -> 'adminEmail', 120, '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
          and coalesce(jsonb_typeof(p_recipients -> 'whatsappEnabled') = 'boolean', false)
          and coalesce(jsonb_typeof(p_recipients -> 'emailEnabled') = 'boolean', false)) then
    raise exception 'invalid_recipients';
  end if;
  update public.admin_config
     set admin_whatsapp = p_recipients ->> 'adminWhatsapp', admin_email = p_recipients ->> 'adminEmail',
         whatsapp_on = (p_recipients ->> 'whatsappEnabled')::boolean, email_on = (p_recipients ->> 'emailEnabled')::boolean
   where id = 1 and updated_at = p_seen;
  if not found then
    if exists (select 1 from public.admin_config where id = 1) then
      raise exception 'stale';
    end if;
    raise exception 'not_found';
  end if;
  perform public.config_saved('recipients');
end $$;

-- A payment method's switch and texts: the owner's. The card stays off until its gateway exists.
create or replace function public.save_payment_method(p_method jsonb, p_seen timestamptz) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id text := p_method ->> 'id';
begin
  if not public.is_admin(array['owner']) then
    raise exception 'forbidden';
  end if;
  p_method := p_method || jsonb_build_object('label', public.config_trim_text(p_method -> 'label'),
                                             'instructions', public.config_trim_text(p_method -> 'instructions'));
  if not (coalesce(jsonb_typeof(p_method -> 'enabled') = 'boolean', false)
          and public.config_text_ok(p_method -> 'label', 40, true)
          and public.config_text_ok(p_method -> 'instructions', 600)) then
    raise exception 'invalid_method';
  end if;
  if v_id = 'card' and (p_method ->> 'enabled')::boolean then
    raise exception 'card_unavailable';
  end if;
  update public.payment_methods
     set enabled = (p_method ->> 'enabled')::boolean, label = p_method -> 'label', instructions = p_method -> 'instructions'
   where id = v_id and updated_at = p_seen;
  if not found then
    if exists (select 1 from public.payment_methods where id = v_id) then
      raise exception 'stale';
    end if;
    raise exception 'not_found';
  end if;
  perform public.config_saved('payment_method', v_id);
end $$;

-- A city's delivery price (src/core/types.ts ShippingRate): owner and manager. p_seen null =
-- a new city, created hidden (shown on purpose, after a check). Its id never changes.
create or replace function public.save_shipping_rate(p_rate jsonb, p_seen timestamptz) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id text := p_rate ->> 'id';
begin
  if not public.is_admin(array['owner', 'manager']) then
    raise exception 'forbidden';
  end if;
  if not public.catalog_id_ok(v_id) then
    raise exception 'invalid_id';
  end if;
  p_rate := p_rate || jsonb_build_object('city', public.config_trim_text(p_rate -> 'city'), 'deliveryDays', public.config_trim_str(p_rate -> 'deliveryDays'));
  if not (public.config_text_ok(p_rate -> 'city', 60, true)
          and public.config_integer_ok(p_rate -> 'distanceKm', 0, 3000)
          and public.config_number_ok(p_rate -> 'baseFee', 0, 1000)
          and public.config_number_ok(p_rate -> 'includedKg', 0, 100)
          and public.config_number_ok(p_rate -> 'extraPerKg', 0, 1000)
          and public.config_string_ok(p_rate -> 'deliveryDays', 20)
          and coalesce(jsonb_typeof(p_rate -> 'active') = 'boolean', false)) then
    raise exception 'invalid_rate';
  end if;
  if p_seen is null then
    if exists (select 1 from public.shipping_rates where id = v_id) then
      raise exception 'exists';
    end if;
    insert into public.shipping_rates (id, city, distance_km, base_fee, included_kg, extra_per_kg, delivery_days, active)
    values (v_id, p_rate -> 'city', (p_rate ->> 'distanceKm')::numeric::integer, (p_rate ->> 'baseFee')::numeric, (p_rate ->> 'includedKg')::numeric,
            (p_rate ->> 'extraPerKg')::numeric, p_rate ->> 'deliveryDays', false);
  else
    update public.shipping_rates
       set city = p_rate -> 'city', distance_km = (p_rate ->> 'distanceKm')::numeric::integer, base_fee = (p_rate ->> 'baseFee')::numeric,
           included_kg = (p_rate ->> 'includedKg')::numeric, extra_per_kg = (p_rate ->> 'extraPerKg')::numeric,
           delivery_days = p_rate ->> 'deliveryDays', active = (p_rate ->> 'active')::boolean
     where id = v_id and updated_at = p_seen;
    if not found then
      if exists (select 1 from public.shipping_rates where id = v_id) then
        raise exception 'stale';
      end if;
      -- an id that does not exist: never a way to rename a city
      raise exception 'not_found';
    end if;
  end if;
  perform public.config_saved('shipping_rate', v_id);
  return v_id;
end $$;
