-- ROLLBACK of 20261013090048_config_trim (P5 slice 11, first part; live version 20261013090048). Supabase SQL Editor, ONE
-- transaction, on a computer. Run it ONLY if the trim of the settings texts must be undone. It restores the four function bodies
-- of 20261012183912_settings_writes.sql, drops config_trim_text then config_trim_str and removes the history row 20261013090048.
-- The settings, payment methods, recipients and delivery prices are not touched. (The tool that applies migrations cannot run a
-- DROP or a DELETE, hence the SQL Editor.)
--
-- ORDER OF THE TWO ROLLBACKS: 20261013100000_catalog_trim.rollback.sql FIRST, then this one.
-- save_product / save_origin (catalog_trim) call config_trim_keys, which calls config_trim_text, which calls config_trim_str.
-- These are SQL functions: Postgres does not track the dependency, so dropping a helper too early does not fail, it breaks the
-- catalog saves at their first call. This script stops by itself while config_trim_keys is still there.
--
-- HOW: paste ALL of it (from "begin;" to the last select), select nothing, press Run. Any check that fails raises an
-- exception ("stop:") and nothing is changed. RESULT: helpers_0 0, version_left_0 0, the last version is 20261012183912.
-- (If 20261013100000_catalog_trim was rolled back first, as it must be, nothing else is newer.)
-- Tests: tests/manual-sql.test.ts keeps the four bodies below equal to the ones in 20261012183912_settings_writes.sql.

begin;

do $$
begin
  if to_regprocedure('public.config_trim_keys(jsonb, text[], text[])') is not null then
    raise exception 'stop: undo 20261013100000_catalog_trim first (supabase/manual/20261013100000_catalog_trim.rollback.sql): save_product and save_origin still call the helpers';
  end if;
  if to_regprocedure('public.config_trim_text(jsonb)') is null or to_regprocedure('public.config_trim_str(jsonb)') is null then
    raise exception 'stop: config_trim_text / config_trim_str are not there, 20261013090048_config_trim is not applied (nothing to undo)';
  end if;
end $$;

-- >>> save_content, save_recipients, save_payment_method and save_shipping_rate of 20261012183912_settings_writes.sql
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
-- <<< save_content, save_recipients, save_payment_method and save_shipping_rate of 20261012183912_settings_writes.sql

drop function public.config_trim_text(jsonb);
drop function public.config_trim_str(jsonb);
delete from supabase_migrations.schema_migrations where version = '20261013090048' and name = 'config_trim';

do $$
begin
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('config_trim_str', 'config_trim_text')) <> 0 then
    raise exception 'stop: the helpers are still there';
  end if;
  if (select md5(replace(prosrc, E'\r', '')) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'save_content') <> 'e2dd9a115e38de8e11959715bb4e8147' then
    raise exception 'stop: save_content is not the slice 10 body';
  end if;
  if (select md5(replace(prosrc, E'\r', '')) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'save_recipients') <> 'be7c4c9ee53eee216e699a4e41f60014' then
    raise exception 'stop: save_recipients is not the slice 10 body';
  end if;
  if (select md5(replace(prosrc, E'\r', '')) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'save_payment_method') <> '98c05c041054edcbae266e6ffc70e52a' then
    raise exception 'stop: save_payment_method is not the slice 10 body';
  end if;
  if (select md5(replace(prosrc, E'\r', '')) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'save_shipping_rate') <> '111299628f84874a1b2c0c1524733e32' then
    raise exception 'stop: save_shipping_rate is not the slice 10 body';
  end if;
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('save_content', 'save_recipients', 'save_payment_method', 'save_shipping_rate')
        and prosecdef and proconfig @> array['search_path=public, pg_temp'] and has_function_privilege('authenticated', oid, 'execute')
        and not has_function_privilege('anon', oid, 'execute')
        and not exists (select 1 from aclexplode(coalesce(proacl, acldefault('f', proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')) <> 4 then
    raise exception 'stop: the rights of the four functions are not the ones of before';
  end if;
  if (select count(*) from supabase_migrations.schema_migrations where version = '20261013090048') <> 0 then
    raise exception 'stop: the history row is still there';
  end if;
end $$;

commit;

select (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname like 'config\_trim%') as helpers_0,
       (select count(*) from supabase_migrations.schema_migrations where version = '20261013090048') as version_left_0,
       (select max(version) from supabase_migrations.schema_migrations) as last_version_is_20261012183912;
