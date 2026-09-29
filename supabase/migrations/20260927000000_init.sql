-- ════════════════════════════════════════════════════════════════════
-- BOGA CAFÉ — production database (Supabase / PostgreSQL)
--
-- Mirrors src/core/types.ts. Principles:
--   • Stock is counted in kg per origin and only changes through functions
--     that also write a stock_movements line (full history).
--   • Orders are written by the server only (Edge Function "create-order"
--     recomputes prices with src/core, then calls commit_order()).
--     commit_order() locks the origin rows, so two customers can never
--     buy the same last kilo.
--   • Customers never read other customers' data (Row Level Security).
--   • Admin roles: owner / manager / staff (same matrix as the prototype).
-- ════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ───────────── Admin users & roles ─────────────

create table public.admin_users (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  role       text not null check (role in ('owner', 'manager', 'staff')),
  full_name  text not null default '',
  created_at timestamptz not null default now()
);

-- Role of the signed-in user, or null for customers / anonymous visitors.
create or replace function public.admin_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.admin_users where user_id = auth.uid()
$$;

create or replace function public.is_admin(allowed text[] default array['owner', 'manager', 'staff'])
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.admin_role() = any (allowed), false)
$$;

-- ───────────── Catalog ─────────────

create table public.origins (
  id                   text primary key,
  name                 jsonb not null,               -- {"ar": "...", "fr": "...", "en": "..."}
  country_code         char(2) not null,
  species              text not null check (species in ('arabica', 'robusta')),
  region               text not null default '',
  roast_level          text not null check (roast_level in ('light', 'medium', 'medium-dark', 'dark')),
  tasting_notes        jsonb not null default '{}'::jsonb,
  -- numeric accepts 'NaN', which sorts above every number (so >= 0 lets it through): refused in every numeric column
  stock_kg             numeric(10, 3) not null default 0 check (stock_kg >= 0 and stock_kg <> 'NaN'),
  low_stock_kg         numeric(10, 3) not null default 5 check (low_stock_kg >= 0 and low_stock_kg <> 'NaN'),
  price_per_kg         numeric(10, 2) not null check (price_per_kg >= 1 and price_per_kg <> 'NaN'), -- a blend is never free (src/core/pricing.ts isPrice)
  custom_blend_enabled boolean not null default true,
  restock_date         date,
  active               boolean not null default true,
  updated_at           timestamptz not null default now()
);

create table public.products (
  id            text primary key,
  slug          text not null unique,
  kind          text not null check (kind in ('signature', 'single-origin', 'b2b')),
  name          jsonb not null,
  tagline       jsonb not null default '{}'::jsonb,
  description   jsonb not null default '{}'::jsonb,
  roast_level   text not null check (roast_level in ('light', 'medium', 'medium-dark', 'dark')),
  tasting_notes jsonb not null default '{}'::jsonb,
  -- price per bag size in MAD, e.g. {"250": 65, "500": 120, "1000": 225}; missing size = not offered
  prices        jsonb not null default '{}'::jsonb,
  image_url     text,
  featured      boolean not null default false,
  active        boolean not null default false,
  sort_order    integer not null default 0,
  updated_at    timestamptz not null default now()
);

create table public.product_recipes (
  product_id text not null references public.products (id) on delete cascade,
  origin_id  text not null references public.origins (id),
  percent    integer not null check (percent between 1 and 100),
  primary key (product_id, origin_id)
);

-- A recipe must add up to exactly 100 % (checked at commit time so it can be edited line by line).
create or replace function public.check_recipe_total() returns trigger
language plpgsql as $$
declare
  pid   text := coalesce(new.product_id, old.product_id);
  total integer;
begin
  if not exists (select 1 from public.products where id = pid) then
    return null; -- product deleted
  end if;
  select coalesce(sum(percent), 0) into total from public.product_recipes where product_id = pid;
  if total <> 100 then
    raise exception 'recipe_total: product % adds up to % %%, expected 100', pid, total;
  end if;
  return null;
end $$;

create constraint trigger product_recipes_total
  after insert or update or delete on public.product_recipes
  deferrable initially deferred
  for each row execute function public.check_recipe_total();

-- ───────────── Delivery, payment methods, configuration ─────────────

create table public.shipping_rates (
  id            text primary key,
  city          jsonb not null,
  distance_km   integer not null default 0,
  base_fee      numeric(10, 2) not null check (base_fee >= 0 and base_fee <> 'NaN'),
  included_kg   numeric(10, 3) not null default 3 check (included_kg <> 'NaN'),
  extra_per_kg  numeric(10, 2) not null default 0 check (extra_per_kg <> 'NaN'),
  delivery_days text not null default '',
  active        boolean not null default true
);

create table public.payment_methods (
  id           text primary key check (id in ('card', 'cashplus', 'bank_transfer')),
  enabled      boolean not null default true,
  label        jsonb not null,
  instructions jsonb not null default '{}'::jsonb
);

-- Public configuration (business rules, texts, contact, bank details shown at payment).
create table public.site_config (
  id       smallint primary key default 1 check (id = 1),
  settings jsonb not null,
  content  jsonb not null
);

-- Private configuration (who receives notifications).
create table public.admin_config (
  id              smallint primary key default 1 check (id = 1),
  admin_whatsapp  text not null default '',
  admin_email     text not null default '',
  whatsapp_on     boolean not null default true,
  email_on        boolean not null default true
);

-- ───────────── Orders ─────────────

create sequence public.order_number_seq;
create sequence public.sample_number_seq;
create sequence public.quote_number_seq;

create table public.orders (
  id               uuid primary key default gen_random_uuid(),
  number           text not null unique,
  created_at       timestamptz not null default now(),
  locale           text not null default 'fr' check (locale in ('ar', 'fr', 'en')),
  customer_name    text not null check (char_length(customer_name) between 1 and 80),
  phone            text not null check (char_length(phone) <= 24),
  email            text not null default '' check (char_length(email) <= 120),
  city_id          text not null references public.shipping_rates (id),
  address          text not null check (char_length(address) <= 200),
  company          text not null default '' check (char_length(company) <= 80),
  notes            text not null default '' check (char_length(notes) <= 500),
  lines            jsonb not null,             -- frozen copy: name, size, qty, prices, grams per origin
  weight_kg        numeric(10, 3) not null check (weight_kg > 0 and weight_kg <> 'NaN'),
  subtotal         numeric(10, 2) not null check (subtotal > 0 and subtotal <> 'NaN'),
  shipping_fee     numeric(10, 2) not null check (shipping_fee >= 0 and shipping_fee <> 'NaN'),
  total            numeric(10, 2) not null check (total > 0 and total <> 'NaN'),
  payment_method   text not null references public.payment_methods (id),
  payment_status   text not null default 'pending'
                   check (payment_status in ('pending', 'awaiting_verification', 'paid', 'failed', 'refunded')),
  payment_ref      text,
  status           text not null default 'new'
                   check (status in ('new', 'confirmed', 'in_production', 'shipped', 'delivered', 'cancelled')),
  stock_deductions jsonb not null,             -- [{"originId": "brazil", "kg": 0.4}, ...]
  stock_returned   boolean not null default false,
  constraint orders_total_adds_up check (total = subtotal + shipping_fee)
);

create index orders_created_idx on public.orders (created_at desc);
create index orders_status_idx on public.orders (status);

create table public.order_events (
  id       bigint generated always as identity primary key,
  order_id uuid not null references public.orders (id) on delete cascade,
  at       timestamptz not null default now(),
  label    text not null,                      -- e.g. order.created, payment.paid, status.shipped
  actor    uuid                                -- admin user, null = system / customer
);

create table public.stock_movements (
  id        bigint generated always as identity primary key,
  at        timestamptz not null default now(),
  origin_id text not null references public.origins (id),
  delta_kg  numeric(10, 3) not null check (delta_kg <> 'NaN'),
  reason    text not null check (reason in ('order', 'order_cancelled', 'restock', 'correction')),
  ref       text not null default '',
  note      text not null default '',
  actor     uuid
);

create index stock_movements_origin_idx on public.stock_movements (origin_id, at desc);

-- ───────────── B2B ─────────────

create table public.sample_requests (
  id              uuid primary key default gen_random_uuid(),
  number          text not null unique,
  created_at      timestamptz not null default now(),
  business_type   text not null check (business_type in ('cafe', 'hotel', 'restaurant', 'company', 'individual', 'other')),
  company         text not null default '' check (char_length(company) <= 80),
  contact_name    text not null check (char_length(contact_name) between 1 and 80),
  phone           text not null check (char_length(phone) <= 24),
  email           text not null default '' check (char_length(email) <= 120),
  city_id         text not null references public.shipping_rates (id),
  product_id      text not null references public.products (id),
  est_monthly_kg  numeric(10, 2) not null default 0 check (est_monthly_kg <> 'NaN'),
  notes           text not null default '' check (char_length(notes) <= 500),
  status          text not null default 'new'
                  check (status in ('new', 'contacted', 'approved', 'shipped', 'closed', 'rejected')),
  free            boolean,                    -- null = not decided
  delivery_fee    numeric(10, 2) not null default 0 check (delivery_fee <> 'NaN'),
  admin_notes     text not null default ''
);

create table public.quote_requests (
  id               uuid primary key default gen_random_uuid(),
  number           text not null unique,
  created_at       timestamptz not null default now(),
  business_type    text not null check (business_type in ('cafe', 'hotel', 'restaurant', 'company', 'individual', 'other')),
  company          text not null default '' check (char_length(company) <= 80),
  contact_name     text not null check (char_length(contact_name) between 1 and 80),
  phone            text not null check (char_length(phone) <= 24),
  email            text not null default '' check (char_length(email) <= 120),
  city_id          text not null references public.shipping_rates (id),
  lines            jsonb not null,
  weight_kg        numeric(10, 3) not null check (weight_kg <> 'NaN'),
  indicative_total numeric(10, 2) not null check (indicative_total <> 'NaN'),
  notes            text not null default '' check (char_length(notes) <= 500),
  status           text not null default 'new' check (status in ('new', 'negotiating', 'confirmed', 'closed')),
  final_price      numeric(10, 2) check (final_price <> 'NaN'),
  admin_notes      text not null default ''
);

-- ───────────── Notifications (outbox) ─────────────
-- Rows are written in the same transaction as the order; the Edge Function
-- "send-notifications" delivers them (WhatsApp Cloud API, Gmail SMTP) and retries.

create table public.notification_outbox (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  channel    text not null check (channel in ('whatsapp', 'email')),
  event      text not null check (event in ('order.created', 'payment.reported', 'sample.created', 'quote.created', 'stock.low')),
  recipient  text not null,
  subject    text not null default '',
  body       text not null,
  status     text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  attempts   integer not null default 0,
  last_error text,
  sent_at    timestamptz
);

create index notification_outbox_pending_idx on public.notification_outbox (created_at) where status = 'pending';

-- ───────────── Helpers ─────────────

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger origins_touch before update on public.origins
  for each row execute function public.touch_updated_at();
create trigger products_touch before update on public.products
  for each row execute function public.touch_updated_at();

-- Queues one message per enabled channel.
create or replace function public.queue_notification(p_event text, p_subject text, p_whatsapp text, p_email text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  cfg public.admin_config;
begin
  select * into cfg from public.admin_config where id = 1;
  if not found then
    return;
  end if;
  if cfg.whatsapp_on and cfg.admin_whatsapp <> '' then
    insert into public.notification_outbox (channel, event, recipient, subject, body)
    values ('whatsapp', p_event, cfg.admin_whatsapp, p_subject, p_whatsapp);
  end if;
  if cfg.email_on and cfg.admin_email <> '' then
    insert into public.notification_outbox (channel, event, recipient, subject, body)
    values ('email', p_event, cfg.admin_email, p_subject, p_email);
  end if;
end $$;

-- Low-stock alert when an origin crosses its threshold.
create or replace function public.alert_low_stock() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.stock_kg <= new.low_stock_kg and old.stock_kg > old.low_stock_kg then
    perform public.queue_notification(
      'stock.low',
      '[BOGA CAFÉ] Stock bas : ' || (new.name ->> 'fr'),
      'Stock bas : ' || (new.name ->> 'fr') || ' - ' || new.stock_kg || ' kg restant',
      'Stock bas : ' || (new.name ->> 'fr') || ' - ' || new.stock_kg || ' kg restant (seuil ' || new.low_stock_kg || ' kg)'
    );
  end if;
  return new;
end $$;

create trigger origins_low_stock after update of stock_kg on public.origins
  for each row execute function public.alert_low_stock();

-- Stock changes only through commit_order, set_order_status, adjust_stock and
-- expire_unpaid_orders (which log a stock movement). A direct UPDATE of
-- stock_kg — even by an admin through the API — is refused.
create or replace function public.guard_stock()
returns trigger
language plpgsql as $$
begin
  if new.stock_kg is distinct from old.stock_kg
     and coalesce(current_setting('boga.stock_write', true), '') <> 'on' then
    raise exception 'stock_changes_go_through_functions';
  end if;
  return new;
end $$;

create trigger origins_guard_stock before update of stock_kg on public.origins
  for each row execute function public.guard_stock();

-- A new origin created from the admin starts at 0 kg: its first stock comes in
-- through adjust_stock('restock'), so it appears in the history. (Imports run
-- by the server itself, without a signed-in user, may set a starting stock.)
create or replace function public.guard_new_origin_stock()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.stock_kg <> 0 and auth.uid() is not null then
    raise exception 'stock_changes_go_through_functions';
  end if;
  return new;
end $$;

create trigger origins_guard_new_stock before insert on public.origins
  for each row execute function public.guard_new_origin_stock();

-- ───────────── Order commit (server only) ─────────────
-- p_order is the object produced by src/core/order.ts buildOrder(), already
-- validated by the Edge Function. This function makes it durable atomically:
-- lock origins → check stock → deduct → insert order + history + movements + notifications.

-- Checks an order against the database itself, the way src/core/order.ts buildOrder
-- builds it: nothing in it is trusted. Sizes and quantities, each line's price (from
-- the product's prices, or recomputed for a Custom Blend), its composition (the
-- product's recipe, or a blend that follows the rules), subtotal, weight, the B2B
-- limit, the city and its delivery fee, the payment method, the customer's name,
-- phone, email and address, and the stock to deduct. Raises invalid_order:<what>.
-- Returns the stock deductions computed here, which commit_order applies.
create or replace function public.check_order(p_order jsonb)
returns jsonb
language plpgsql stable set search_path = public as $$
declare
  s           jsonb := (select settings from public.site_config where id = 1);
  v_line      jsonb;
  v_part      jsonb;
  v_product   public.products;
  v_origin    public.origins;
  v_rate      public.shipping_rates;
  v_size      numeric;
  v_qty       numeric;
  v_unit      numeric;
  v_expected  numeric;
  v_percent   numeric;
  v_total_pct numeric;
  v_count     integer;
  v_subtotal  numeric := 0;
  v_weight    numeric := 0;
  v_fee       numeric;
  v_extra_kg  numeric;
  v_free      numeric := coalesce((s ->> 'freeShippingOver')::numeric, 0);
  v_loss      numeric := coalesce((s ->> 'roastLossPercent')::numeric, 0);
  v_min_pct   numeric := coalesce((s #>> '{customBlend,minPercent}')::numeric, 5);
  v_max_orig  numeric := coalesce((s #>> '{customBlend,maxOrigins}')::numeric, 4);
  v_need      jsonb := '{}'::jsonb;   -- originId -> kg, before rounding
  v_result    jsonb := '[]'::jsonb;
  v_given     numeric;
  k           text;
  v_phone     text := regexp_replace(coalesce(p_order #>> '{customer,phone}', ''), '[\s.\-()]', '', 'g');
  v_email     text := btrim(coalesce(p_order #>> '{customer,email}', ''));
begin
  if s is null or v_loss < 0 or v_loss >= 100 then
    raise exception 'invalid_order:settings';
  end if;
  if coalesce(p_order ->> 'locale', 'fr') not in ('ar', 'fr', 'en') then
    raise exception 'invalid_order:locale';
  end if;
  -- customer (src/core/order.ts validateCustomer, src/core/validation.ts)
  if char_length(btrim(coalesce(p_order #>> '{customer,fullName}', ''))) < 3 then
    raise exception 'invalid_order:name';
  end if;
  if v_phone !~ '^(\+212|00212|0)[5-7][0-9]{8}$' then
    raise exception 'invalid_order:phone';
  end if;
  if v_email <> '' and v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' then
    raise exception 'invalid_order:email';
  end if;
  if char_length(btrim(coalesce(p_order #>> '{customer,address}', ''))) < 6 then
    raise exception 'invalid_order:address';
  end if;

  if jsonb_typeof(p_order -> 'lines') is distinct from 'array' or jsonb_array_length(p_order -> 'lines') = 0 then
    raise exception 'invalid_order:lines';
  end if;
  for v_line in select value from jsonb_array_elements(p_order -> 'lines') loop
    -- bag size and quantity (src/core/cart.ts PACK_SIZES, isValidQty: 1 to 100 bags)
    if jsonb_typeof(v_line -> 'size') is distinct from 'number' or jsonb_typeof(v_line -> 'qty') is distinct from 'number'
       or jsonb_typeof(v_line -> 'unitPrice') is distinct from 'number' or jsonb_typeof(v_line -> 'lineTotal') is distinct from 'number'
       or jsonb_typeof(v_line -> 'composition') is distinct from 'array' then
      raise exception 'invalid_order:line';
    end if;
    v_size := (v_line ->> 'size')::numeric;
    v_qty  := (v_line ->> 'qty')::numeric;
    v_unit := (v_line ->> 'unitPrice')::numeric;
    if v_size not in (250, 500, 1000) then
      raise exception 'invalid_order:size';
    end if;
    if v_qty <> trunc(v_qty) or v_qty < 1 or v_qty > 100 then
      raise exception 'invalid_order:qty';
    end if;

    if v_line ->> 'kind' = 'product' then
      select * into v_product from public.products where id = v_line ->> 'productId' and active;
      if not found then
        raise exception 'invalid_order:product';
      end if;
      -- the price of this size, a real price (src/core/pricing.ts productPrice, isPrice)
      v_expected := case when jsonb_typeof(v_product.prices -> v_size::integer::text) = 'number'
                         then (v_product.prices ->> v_size::integer::text)::numeric end;
      if v_expected is null or v_expected < 1 then
        raise exception 'invalid_order:size_not_offered';
      end if;
      if v_unit <> v_expected then
        raise exception 'invalid_order:price';
      end if;
      -- the composition is the product's recipe, nothing else
      if jsonb_array_length(v_line -> 'composition') <> (select count(*) from public.product_recipes where product_id = v_product.id)
         or exists (select 1 from public.product_recipes r
                     where r.product_id = v_product.id
                       and not exists (select 1 from jsonb_array_elements(v_line -> 'composition') c
                                        where c ->> 'originId' = r.origin_id
                                          and jsonb_typeof(c -> 'percent') = 'number'
                                          and (c ->> 'percent')::numeric = r.percent)) then
        raise exception 'invalid_order:composition';
      end if;
    elsif v_line ->> 'kind' = 'custom' then
      -- Custom Blend (src/core/blend.ts validateBlend, pricing.ts customBlendPrice)
      if coalesce((s #>> '{customBlend,enabled}')::boolean, false) is not true then
        raise exception 'invalid_order:blend_paused';
      end if;
      v_count := jsonb_array_length(v_line -> 'composition');
      if v_count = 0 or v_count > v_max_orig
         or (select count(distinct c ->> 'originId') from jsonb_array_elements(v_line -> 'composition') c) <> v_count then
        raise exception 'invalid_order:blend';
      end if;
      v_total_pct := 0;
      v_expected := coalesce((s #>> array['customBlend', 'feeBySize', v_size::integer::text])::numeric, 0);
      for v_part in select value from jsonb_array_elements(v_line -> 'composition') loop
        if jsonb_typeof(v_part -> 'percent') is distinct from 'number' then
          raise exception 'invalid_order:blend';
        end if;
        v_percent := (v_part ->> 'percent')::numeric;
        if v_percent <> trunc(v_percent) or v_percent < v_min_pct then
          raise exception 'invalid_order:blend';
        end if;
        select * into v_origin from public.origins where id = v_part ->> 'originId';
        if not found or not v_origin.active or not v_origin.custom_blend_enabled or v_origin.price_per_kg < 1 then
          raise exception 'invalid_order:blend_origin';
        end if;
        v_total_pct := v_total_pct + v_percent;
        v_expected := v_expected + v_origin.price_per_kg * (v_size * v_percent / 100) / 1000;
      end loop;
      if v_total_pct <> 100 then
        raise exception 'invalid_order:blend';
      end if;
      v_expected := round(v_expected);
      -- the browser adds binary fractions: one dirham of difference is rounding, not a new price
      if v_expected < 1 or abs(v_unit - v_expected) > 1 then
        raise exception 'invalid_order:price';
      end if;
    else
      raise exception 'invalid_order:kind';
    end if;

    if (v_line ->> 'lineTotal')::numeric <> round(v_unit * v_qty) then
      raise exception 'invalid_order:line_total';
    end if;
    v_subtotal := v_subtotal + (v_line ->> 'lineTotal')::numeric;
    v_weight := v_weight + v_size / 1000 * v_qty;
    -- stock this line needs (src/core/stock.ts kgNeeded)
    for v_part in select value from jsonb_array_elements(v_line -> 'composition') loop
      v_need := jsonb_set(v_need, array[v_part ->> 'originId'],
        to_jsonb(coalesce((v_need ->> (v_part ->> 'originId'))::numeric, 0)
                 + (v_size / 1000) * ((v_part ->> 'percent')::numeric / 100) * v_qty / (1 - v_loss / 100)));
    end loop;
  end loop;

  if jsonb_typeof(p_order -> 'subtotal') is distinct from 'number' or (p_order ->> 'subtotal')::numeric <> round(v_subtotal) then
    raise exception 'invalid_order:subtotal';
  end if;
  if jsonb_typeof(p_order -> 'weightKg') is distinct from 'number' or (p_order ->> 'weightKg')::numeric <> round(v_weight, 3) then
    raise exception 'invalid_order:weight';
  end if;
  -- above the B2B limit the order is a quote, not a cart (src/core/cart.ts isB2B)
  if v_weight > coalesce((s ->> 'b2bThresholdKg')::numeric, 10) then
    raise exception 'invalid_order:b2b';
  end if;
  -- delivery (src/core/shipping.ts shippingFee)
  select * into v_rate from public.shipping_rates where id = p_order #>> '{customer,cityId}' and active;
  if not found then
    raise exception 'invalid_order:city';
  end if;
  if v_free > 0 and round(v_subtotal) >= v_free then
    v_fee := 0;
  else
    v_extra_kg := greatest(0, ceil(round(v_weight, 3) - v_rate.included_kg - 0.000000001));
    v_fee := round(v_rate.base_fee + v_extra_kg * v_rate.extra_per_kg);
  end if;
  if jsonb_typeof(p_order -> 'shippingFee') is distinct from 'number' or (p_order ->> 'shippingFee')::numeric <> v_fee then
    raise exception 'invalid_order:shipping';
  end if;
  if jsonb_typeof(p_order -> 'total') is distinct from 'number' or (p_order ->> 'total')::numeric <> round(v_subtotal) + v_fee then
    raise exception 'invalid_order:total';
  end if;
  if not exists (select 1 from public.payment_methods where id = p_order ->> 'paymentMethod' and enabled) then
    raise exception 'invalid_order:payment_method';
  end if;

  -- the stock to deduct is computed here; the browser's figures must agree to the gram
  if jsonb_typeof(p_order -> 'stockDeductions') is distinct from 'array'
     or jsonb_array_length(p_order -> 'stockDeductions') <> (select count(*) from jsonb_object_keys(v_need))
     or (select count(distinct d ->> 'originId') from jsonb_array_elements(p_order -> 'stockDeductions') d)
        <> jsonb_array_length(p_order -> 'stockDeductions') then
    raise exception 'invalid_order:deductions';
  end if;
  for k in select jsonb_object_keys(v_need) loop
    select (d ->> 'kg')::numeric into v_given
      from jsonb_array_elements(p_order -> 'stockDeductions') d where d ->> 'originId' = k;
    if v_given is null or abs(v_given - round((v_need ->> k)::numeric, 3)) > 0.001 then
      raise exception 'invalid_order:deductions';
    end if;
    v_result := v_result || jsonb_build_object('originId', k, 'kg', round((v_need ->> k)::numeric, 3));
  end loop;
  return v_result;
end $$;

create or replace function public.commit_order(p_order jsonb, p_whatsapp text, p_email text, p_subject text)
returns table (id uuid, number text)
language plpgsql security definer set search_path = public as $$
declare
  d          jsonb;
  v_deductions jsonb;
  v_origin   public.origins;
  v_id       uuid := gen_random_uuid();
  v_seq      bigint := nextval('public.order_number_seq');
  -- lpad would cut 10000 to '1000': pad to 4 digits, never shorten
  v_number   text := 'BC-' || to_char(now(), 'YYYY') || '-' || lpad(v_seq::text, greatest(4, length(v_seq::text)), '0');
begin
  -- refuse anything that could add stock or be free before looking further
  if jsonb_typeof(p_order -> 'stockDeductions') is distinct from 'array'
     or jsonb_array_length(p_order -> 'stockDeductions') = 0
     or exists (select 1 from jsonb_array_elements(p_order -> 'stockDeductions') x
                where coalesce((x ->> 'kg')::numeric, 0) <= 0
                   or (x ->> 'kg')::numeric in ('NaN', 'Infinity')) then
    raise exception 'invalid_order';
  end if;
  -- everything else in the order is checked against the database; the deductions used
  -- below are the ones computed there
  v_deductions := public.check_order(p_order);
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
    lines, weight_kg, subtotal, shipping_fee, total, payment_method, stock_deductions
  ) values (
    v_id, v_number,
    coalesce(p_order ->> 'locale', 'fr'),
    p_order #>> '{customer,fullName}',
    p_order #>> '{customer,phone}',
    coalesce(p_order #>> '{customer,email}', ''),
    p_order #>> '{customer,cityId}',
    p_order #>> '{customer,address}',
    coalesce(p_order #>> '{customer,company}', ''),
    coalesce(p_order #>> '{customer,notes}', ''),
    p_order -> 'lines',
    (p_order ->> 'weightKg')::numeric,
    (p_order ->> 'subtotal')::numeric,
    (p_order ->> 'shippingFee')::numeric,
    (p_order ->> 'total')::numeric,
    p_order ->> 'paymentMethod',
    v_deductions
  );

  insert into public.order_events (order_id, label) values (v_id, 'order.created');
  perform public.queue_notification('order.created', replace(p_subject, '{number}', v_number),
                                    replace(p_whatsapp, '{number}', v_number), replace(p_email, '{number}', v_number));
  perform set_config('boga.stock_write', '', true);
  return query select v_id, v_number;
end $$;

-- ───────────── Admin actions ─────────────

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

create or replace function public.adjust_stock(p_origin_id text, p_delta_kg numeric, p_reason text, p_note text default '')
returns numeric
language plpgsql security definer set search_path = public as $$
declare
  v_before numeric;
  v_stock  numeric;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if p_reason not in ('restock', 'correction') then
    raise exception 'invalid_reason';
  end if;
  -- a real, finite number of kg ('NaN' and 'Infinity' are valid numeric values)
  if p_delta_kg is null or p_delta_kg in ('NaN', 'Infinity', '-Infinity') then
    raise exception 'invalid_delta';
  end if;
  select stock_kg into v_before from public.origins where id = p_origin_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  perform set_config('boga.stock_write', 'on', true);
  update public.origins set stock_kg = greatest(0, stock_kg + p_delta_kg)
   where id = p_origin_id
   returning stock_kg into v_stock;
  perform set_config('boga.stock_write', '', true);
  -- the history records the change that really happened (stock cannot go under 0)
  insert into public.stock_movements (origin_id, delta_kg, reason, note, actor)
  values (p_origin_id, v_stock - v_before, p_reason, p_note, auth.uid());
  return v_stock;
end $$;

-- Unpaid orders past the limit set in Admin → Settings (unpaidOrderTimeoutHours)
-- are cancelled and give their coffee back, so an abandoned transfer cannot
-- hold the stock. Same rule as src/core/order.ts expiredUnpaidOrders().
-- Schedule it every 15 minutes (Supabase → Database → Cron, pg_cron):
--   select cron.schedule('expire-unpaid-orders', '*/15 * * * *', 'select public.expire_unpaid_orders()');
create or replace function public.expire_unpaid_orders()
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_hours numeric;
  v_order public.orders;
  d       jsonb;
  n       integer := 0;
begin
  select coalesce((settings ->> 'unpaidOrderTimeoutHours')::numeric, 0) into v_hours
    from public.site_config where id = 1;
  if coalesce(v_hours, 0) <= 0 then
    return 0;
  end if;
  perform set_config('boga.stock_write', 'on', true);
  for v_order in
    select * from public.orders
     where status = 'new' and payment_status in ('pending', 'failed')
       and created_at < now() - make_interval(secs => v_hours * 3600)
     order by created_at
     for update skip locked
  loop
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

-- Settings hold the bank details shown to customers and the business rules:
-- only the owner changes them. Managers keep editing the site texts (content).
create or replace function public.guard_settings()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- managers may change the free-shipping threshold (Livraison page) and
  -- nothing else: same rule as MANAGER_SETTINGS in src/core/orderFlow.ts
  if (new.settings - 'freeShippingOver') is distinct from (old.settings - 'freeShippingOver')
     and auth.uid() is not null
     and not public.is_admin(array['owner']) then
    raise exception 'owner_only';
  end if;
  -- the storefront computes every delivery fee with it: a number, 0 or more
  if new.settings -> 'freeShippingOver' is distinct from old.settings -> 'freeShippingOver'
     and not (case when jsonb_typeof(new.settings -> 'freeShippingOver') = 'number'
                   then (new.settings ->> 'freeShippingOver')::numeric >= 0
                   else false end) then
    raise exception 'invalid_settings';
  end if;
  return new;
end $$;

create trigger site_config_guard_settings before update on public.site_config
  for each row execute function public.guard_settings();

-- Customer order page: the order id is an unguessable UUID shared only with the buyer.
create or replace function public.get_order_public(p_order_id uuid)
returns table (
  number text, created_at timestamptz, customer_name text, city_id text, lines jsonb,
  weight_kg numeric, subtotal numeric, shipping_fee numeric, total numeric,
  payment_method text, payment_status text, status text
)
language sql stable security definer set search_path = public as $$
  select o.number, o.created_at, o.customer_name, o.city_id, o.lines, o.weight_kg, o.subtotal,
         o.shipping_fee, o.total, o.payment_method, o.payment_status, o.status
    from public.orders o
   where o.id = p_order_id
$$;

-- Customer reports a Cash Plus / transfer payment (only while it is pending).
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
   where id = p_order_id and payment_status = 'pending' and payment_method <> 'card' and status <> 'cancelled'
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

-- ───────────── Row Level Security ─────────────

alter table public.admin_users         enable row level security;
alter table public.origins             enable row level security;
alter table public.products            enable row level security;
alter table public.product_recipes     enable row level security;
alter table public.shipping_rates      enable row level security;
alter table public.payment_methods     enable row level security;
alter table public.site_config         enable row level security;
alter table public.admin_config        enable row level security;
alter table public.orders              enable row level security;
alter table public.order_events        enable row level security;
alter table public.stock_movements     enable row level security;
alter table public.sample_requests     enable row level security;
alter table public.quote_requests      enable row level security;
alter table public.notification_outbox enable row level security;

-- Public catalog: everyone reads what is active.
create policy "catalog read" on public.origins for select using (active or public.is_admin());
create policy "catalog read" on public.products for select using (active or public.is_admin());
create policy "catalog read" on public.product_recipes for select using (true);
create policy "catalog read" on public.shipping_rates for select using (active or public.is_admin());
create policy "catalog read" on public.payment_methods for select using (enabled or public.is_admin());
create policy "config read" on public.site_config for select using (true);

-- Catalog, prices, delivery and texts: owner + manager. (Staff moves stock via adjust_stock().)
create policy "catalog write" on public.origins for all
  using (public.is_admin(array['owner', 'manager'])) with check (public.is_admin(array['owner', 'manager']));
create policy "catalog write" on public.products for all
  using (public.is_admin(array['owner', 'manager'])) with check (public.is_admin(array['owner', 'manager']));
create policy "catalog write" on public.product_recipes for all
  using (public.is_admin(array['owner', 'manager'])) with check (public.is_admin(array['owner', 'manager']));
create policy "catalog write" on public.shipping_rates for all
  using (public.is_admin(array['owner', 'manager'])) with check (public.is_admin(array['owner', 'manager']));
create policy "config write" on public.site_config for update
  using (public.is_admin(array['owner', 'manager'])) with check (public.is_admin(array['owner', 'manager']));

-- Money and access: owner only.
create policy "owner only" on public.payment_methods for update
  using (public.is_admin(array['owner'])) with check (public.is_admin(array['owner']));
create policy "owner only" on public.admin_config for all
  using (public.is_admin(array['owner'])) with check (public.is_admin(array['owner']));
create policy "owner manages admins" on public.admin_users for all
  using (public.is_admin(array['owner'])) with check (public.is_admin(array['owner']));
create policy "see own admin row" on public.admin_users for select using (user_id = auth.uid());

-- Operations: every admin role reads; status changes go through the functions above.
create policy "admins read" on public.orders for select using (public.is_admin());
create policy "admins read" on public.order_events for select using (public.is_admin());
create policy "admins read" on public.stock_movements for select using (public.is_admin());
create policy "admins read" on public.notification_outbox for select using (public.is_admin(array['owner', 'manager']));
create policy "admins manage" on public.sample_requests for all using (public.is_admin()) with check (public.is_admin());
create policy "admins manage" on public.quote_requests for all using (public.is_admin()) with check (public.is_admin());

-- Functions: who may call what.
revoke all on function public.check_order(jsonb) from public, anon, authenticated;
revoke all on function public.commit_order(jsonb, text, text, text) from public, anon, authenticated;
grant execute on function public.commit_order(jsonb, text, text, text) to service_role;
revoke all on function public.expire_unpaid_orders() from public, anon, authenticated;
grant execute on function public.expire_unpaid_orders() to service_role;
revoke all on function public.queue_notification(text, text, text, text) from public, anon, authenticated;
grant execute on function public.queue_notification(text, text, text, text) to service_role;
revoke all on function public.set_order_status(uuid, text) from public, anon;
revoke all on function public.set_payment_status(uuid, text) from public, anon;
revoke all on function public.adjust_stock(text, numeric, text, text) from public, anon;
grant execute on function public.set_order_status(uuid, text) to authenticated;
grant execute on function public.set_payment_status(uuid, text) to authenticated;
grant execute on function public.adjust_stock(text, numeric, text, text) to authenticated;
grant execute on function public.get_order_public(uuid) to anon, authenticated;
grant execute on function public.report_offline_payment(uuid, text) to anon, authenticated;
