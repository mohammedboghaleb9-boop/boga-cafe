-- Settings, payments, texts, message recipients and delivery prices (P5 slice 10): saved by
-- the Admin Panel through one function per part, never by a direct table write.
--
-- Rules, all checked here, not only in the panel:
--   • who, always past the second factor (is_admin at aal2): the business rules, payment
--     methods, payee details and message recipients are the owner's; the texts and the
--     delivery prices (free-shipping threshold included) are the owner's and the manager's;
--     the contact details stay the owner's (as guard_settings already says);
--   • what: every value is checked (ranges, lengths, formats); the card cannot be switched
--     on before its gateway exists; a payee is all filled in or all empty, never half, and
--     a Cash Plus payee is a name, a city and a phone, never an identity card number;
--   • when: a save from an older copy of the page is refused ('stale'). Each part has its
--     own version mark (a manager's text never refuses the owner's rules), compared as the
--     page read it: the panel fills missing keys with defaults, so its values could not be;
--   • who did it: config_changes (the part and the time, never the values);
--   • no DELETE and no DROP here: the tool that applies migrations to the live project
--     hangs on them (a city is hidden, never deleted: orders keep their city).

alter table public.site_config add column versions jsonb not null default '{}'::jsonb;
alter table public.admin_config add column updated_at timestamptz not null default now();
alter table public.payment_methods add column updated_at timestamptz not null default now();
alter table public.shipping_rates add column updated_at timestamptz not null default now();
create trigger admin_config_touch before update on public.admin_config
  for each row execute function public.touch_updated_at();
create trigger payment_methods_touch before update on public.payment_methods
  for each row execute function public.touch_updated_at();
create trigger shipping_rates_touch before update on public.shipping_rates
  for each row execute function public.touch_updated_at();

create table public.config_changes (
  id      bigint generated always as identity primary key,
  at      timestamptz not null default now(),
  area    text not null check (area in ('rules', 'free_shipping', 'payee', 'content', 'contact', 'recipients', 'payment_method', 'shipping_rate')),
  item_id text not null default '',
  actor   uuid
);
create index config_changes_area_idx on public.config_changes (area, at desc);
alter table public.config_changes enable row level security;
create policy "admins read" on public.config_changes for select using (public.is_admin());
revoke all on public.config_changes from anon, authenticated;
grant select on public.config_changes to authenticated;

-- A JSON number from p_min to p_max (JSON has no NaN or Infinity); false when missing.
create or replace function public.config_number_ok(p_value jsonb, p_min numeric, p_max numeric) returns boolean
language sql immutable set search_path = public, pg_temp as $$
  select coalesce(jsonb_typeof(p_value) = 'number' and (p_value #>> '{}')::numeric between p_min and p_max, false)
$$;

-- The same, a whole number.
create or replace function public.config_integer_ok(p_value jsonb, p_min numeric, p_max numeric) returns boolean
language sql immutable set search_path = public, pg_temp as $$
  select public.config_number_ok(p_value, p_min, p_max) and (p_value #>> '{}')::numeric = trunc((p_value #>> '{}')::numeric)
$$;

-- A JSON string of at most p_max characters, empty or matching p_pattern; false when missing.
create or replace function public.config_string_ok(p_value jsonb, p_max integer, p_pattern text default null) returns boolean
language sql immutable set search_path = public, pg_temp as $$
  select coalesce(jsonb_typeof(p_value) = 'string' and char_length(p_value #>> '{}') <= p_max
                  and (p_pattern is null or p_value #>> '{}' = '' or (p_value #>> '{}') ~ p_pattern), false)
$$;

-- A text in three languages (catalog_text_ok), with a French one when p_required; false when missing.
create or replace function public.config_text_ok(p_value jsonb, p_max integer, p_required boolean default false) returns boolean
language sql immutable set search_path = public, pg_temp as $$
  select coalesce(public.catalog_text_ok(p_value, p_max), false)
     and (not p_required or coalesce(btrim(p_value ->> 'fr'), '') <> '')
$$;

-- The settings row, locked for this save; 'stale' when the part changed since the page read it.
create or replace function public.config_section_seen(p_section text, p_seen text) returns void
language plpgsql set search_path = public, pg_temp as $$
declare
  v_mark text;
begin
  select versions ->> p_section into v_mark from public.site_config where id = 1 for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_mark is distinct from p_seen then
    raise exception 'stale';
  end if;
end $$;

-- Who saved which part, and when.
create or replace function public.config_saved(p_area text, p_item text default '') returns void
language sql set search_path = public, pg_temp as $$
  insert into public.config_changes (area, item_id, actor) values (p_area, coalesce(p_item, ''), auth.uid())
$$;

-- p_rules: src/core/types.ts BusinessRules; p_seen: versions.rules as the page read it.
create or replace function public.save_rules(p_rules jsonb, p_seen text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin(array['owner']) then
    raise exception 'forbidden';
  end if;
  if not (public.config_number_ok(p_rules -> 'b2bThresholdKg', 1, 1000)
          and public.config_number_ok(p_rules -> 'roastLossPercent', 0, 30)
          and public.config_number_ok(p_rules -> 'unpaidOrderTimeoutHours', 1, 720)
          and public.config_number_ok(p_rules -> 'paymentCheckTimeoutHours', 1, 720)
          and coalesce(jsonb_typeof(p_rules #> '{customBlend,enabled}') = 'boolean', false)
          and public.config_integer_ok(p_rules #> '{customBlend,minPercent}', 1, 50)
          and public.config_integer_ok(p_rules #> '{customBlend,maxOrigins}', 1, 8)
          and public.config_number_ok(p_rules #> '{customBlend,feeBySize,250}', 0, 1000)
          and public.config_number_ok(p_rules #> '{customBlend,feeBySize,500}', 0, 1000)
          and public.config_number_ok(p_rules #> '{customBlend,feeBySize,1000}', 0, 1000)) then
    raise exception 'invalid_settings';
  end if;
  perform public.config_section_seen('rules', p_seen);
  -- only these keys, rebuilt: nothing else the page sends reaches the settings
  update public.site_config
     set settings = settings || jsonb_build_object(
           'b2bThresholdKg', p_rules -> 'b2bThresholdKg',
           'roastLossPercent', p_rules -> 'roastLossPercent',
           'unpaidOrderTimeoutHours', p_rules -> 'unpaidOrderTimeoutHours',
           'paymentCheckTimeoutHours', p_rules -> 'paymentCheckTimeoutHours',
           'customBlend', jsonb_build_object(
             'enabled', p_rules #> '{customBlend,enabled}',
             'minPercent', p_rules #> '{customBlend,minPercent}',
             'maxOrigins', p_rules #> '{customBlend,maxOrigins}',
             'feeBySize', jsonb_build_object('250', p_rules #> '{customBlend,feeBySize,250}',
                                             '500', p_rules #> '{customBlend,feeBySize,500}',
                                             '1000', p_rules #> '{customBlend,feeBySize,1000}'))),
         versions = versions || jsonb_build_object('rules', clock_timestamp()::text)
   where id = 1;
  perform public.config_saved('rules');
end $$;

-- The free-shipping threshold (Livraison page): owner and manager. 0 = never free.
create or replace function public.save_free_shipping(p_amount numeric, p_seen text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin(array['owner', 'manager']) then
    raise exception 'forbidden';
  end if;
  -- 'NaN' and 'Infinity' are valid numeric values, and outside this range
  if p_amount is null or p_amount = 'NaN' or p_amount not between 0 and 100000 then
    raise exception 'invalid_settings';
  end if;
  perform public.config_section_seen('freeShipping', p_seen);
  update public.site_config
     set settings = settings || jsonb_build_object('freeShippingOver', p_amount),
         versions = versions || jsonb_build_object('freeShipping', clock_timestamp()::text)
   where id = 1;
  perform public.config_saved('free_shipping');
end $$;

-- p_payee: {"bank": {holder, bankName, rib}, "cashplus": {beneficiary, city, phone}}. Shown to
-- the customers who pay by transfer or Cash Plus (src/features/checkout/PaymentPanel.tsx): a
-- method is offered once its payee is complete (payeeReady, check_order). The RIB: 24 digits
-- (its check key is not verified: no official source for the Moroccan rule was found).
create or replace function public.save_payee(p_payee jsonb, p_seen text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_bank jsonb;
  v_cash jsonb;
begin
  if not public.is_admin(array['owner']) then
    raise exception 'forbidden';
  end if;
  if not (public.config_string_ok(p_payee #> '{bank,holder}', 80)
          and public.config_string_ok(p_payee #> '{bank,bankName}', 80)
          and public.config_string_ok(p_payee #> '{bank,rib}', 24, '^[0-9]{24}$')
          and public.config_string_ok(p_payee #> '{cashplus,beneficiary}', 80)
          and public.config_string_ok(p_payee #> '{cashplus,city}', 60)
          and public.config_string_ok(p_payee #> '{cashplus,phone}', 16, '^\+?[0-9]{8,15}$')) then
    raise exception 'invalid_payee';
  end if;
  -- only these keys, trimmed: no other field (an identity card number…) is ever kept
  v_bank := jsonb_build_object('holder', btrim(p_payee #>> '{bank,holder}'), 'bankName', btrim(p_payee #>> '{bank,bankName}'),
                               'rib', p_payee #>> '{bank,rib}');
  v_cash := jsonb_build_object('beneficiary', btrim(p_payee #>> '{cashplus,beneficiary}'), 'city', btrim(p_payee #>> '{cashplus,city}'),
                               'phone', p_payee #>> '{cashplus,phone}');
  -- all filled in, or all empty (the method is then not offered): never half a payee
  if (select count(*) from jsonb_each_text(v_bank) e where e.value <> '') not in (0, 3)
     or (select count(*) from jsonb_each_text(v_cash) e where e.value <> '') not in (0, 3) then
    raise exception 'incomplete_payee';
  end if;
  perform public.config_section_seen('payee', p_seen);
  update public.site_config
     set settings = settings || jsonb_build_object('bank', v_bank, 'cashplus', v_cash),
         versions = versions || jsonb_build_object('payee', clock_timestamp()::text)
   where id = 1;
  perform public.config_saved('payee');
end $$;

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
    values (v_id, p_rate -> 'city', (p_rate ->> 'distanceKm')::integer, (p_rate ->> 'baseFee')::numeric, (p_rate ->> 'includedKg')::numeric,
            (p_rate ->> 'extraPerKg')::numeric, p_rate ->> 'deliveryDays', false);
  else
    update public.shipping_rates
       set city = p_rate -> 'city', distance_km = (p_rate ->> 'distanceKm')::integer, base_fee = (p_rate ->> 'baseFee')::numeric,
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

revoke all on function public.config_number_ok(jsonb, numeric, numeric) from public, anon, authenticated;
revoke all on function public.config_integer_ok(jsonb, numeric, numeric) from public, anon, authenticated;
revoke all on function public.config_string_ok(jsonb, integer, text) from public, anon, authenticated;
revoke all on function public.config_text_ok(jsonb, integer, boolean) from public, anon, authenticated;
revoke all on function public.config_section_seen(text, text) from public, anon, authenticated;
revoke all on function public.config_saved(text, text) from public, anon, authenticated;
revoke all on function public.save_rules(jsonb, text) from public, anon;
revoke all on function public.save_free_shipping(numeric, text) from public, anon;
revoke all on function public.save_payee(jsonb, text) from public, anon;
revoke all on function public.save_content(jsonb, jsonb, text, text) from public, anon;
revoke all on function public.save_recipients(jsonb, timestamptz) from public, anon;
revoke all on function public.save_payment_method(jsonb, timestamptz) from public, anon;
revoke all on function public.save_shipping_rate(jsonb, timestamptz) from public, anon;
grant execute on function public.save_rules(jsonb, text) to authenticated;
grant execute on function public.save_free_shipping(numeric, text) to authenticated;
grant execute on function public.save_payee(jsonb, text) to authenticated;
grant execute on function public.save_content(jsonb, jsonb, text, text) to authenticated;
grant execute on function public.save_recipients(jsonb, timestamptz) to authenticated;
grant execute on function public.save_payment_method(jsonb, timestamptz) to authenticated;
grant execute on function public.save_shipping_rate(jsonb, timestamptz) to authenticated;

-- These change only through the functions above, which run as the tables' owner: the API
-- roles keep reading them (row level security), nothing else ("config write", "catalog
-- write" and "owner only" stay, without effect; guard_settings stays as a second check).
-- Who receives the messages is read by the owner's session only: anon loses even SELECT.
revoke all on public.site_config, public.payment_methods, public.shipping_rates, public.admin_config from anon, authenticated;
grant select on public.site_config, public.payment_methods, public.shipping_rates to anon, authenticated;
grant select on public.admin_config to authenticated;
