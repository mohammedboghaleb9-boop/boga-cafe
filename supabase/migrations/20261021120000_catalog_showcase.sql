-- The catalog shown without prices while the sales are closed (P5, owner 2026-10-21).
--
-- The owner shows the previous site's catalog (10 products, 6 origins, their recipes, texts and pictures) for review,
-- without prices and without any way to buy: this is a display, never an activation. `active` keeps meaning "for
-- sale" (row security shows visitors only active rows, an active origin needs a price, check_order sells only active
-- products and origins); `listed` is a separate "shown on the site" flag, false for every row, so a new product or
-- origin stays hidden until it is listed on purpose. This file lists nothing: the 16 rows are listed by their own
-- reviewed block (supabase/manual/20261021120000_catalog_showcase.listing.sql), which stops if the catalog changed.
--
-- showcase_catalog() is the only public read of listed rows: the display fields only (no price, stock, low-stock
-- level, restock date, sale switch or change time), and a product only when every origin of its recipe is listed
-- too. Nobody gets a new write: no grant on the tables changes, save_product and save_origin keep their column lists
-- (a new row starts unlisted, an edit keeps the flag), and only the SQL Editor sets `listed`.
-- While the sales are closed no price leaves the database at all: the visitors' read of the products and origins
-- tables (prices, price per kg, stock, restock date) shows the rows for sale only once the sales are open
-- (sales_open(): exactly true, as the gate of commit_order); admins still read every row.
-- Rollback: supabase/manual/20261021120000_catalog_showcase.rollback.sql (SQL Editor).

alter table public.products add column listed boolean not null default false;
alter table public.origins add column listed boolean not null default false;

create function public.showcase_catalog()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'products', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'slug', p.slug, 'kind', p.kind, 'name', p.name, 'tagline', p.tagline, 'description', p.description,
        'tasting_notes', p.tasting_notes, 'roast_level', p.roast_level, 'featured', p.featured,
        'sort_order', p.sort_order, 'image_url', p.image_url,
        'recipe', (select jsonb_agg(jsonb_build_object('origin_id', r.origin_id, 'percent', r.percent) order by r.origin_id)
                   from public.product_recipes r where r.product_id = p.id)
      ) order by p.sort_order, p.id)
      from public.products p
      where p.listed
        and exists (select 1 from public.product_recipes r where r.product_id = p.id)
        and not exists (select 1 from public.product_recipes r join public.origins o on o.id = r.origin_id
                        where r.product_id = p.id and not o.listed)
    ), '[]'::jsonb),
    'origins', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'name', o.name, 'country_code', o.country_code, 'species', o.species, 'region', o.region,
        'roast_level', o.roast_level, 'tasting_notes', o.tasting_notes, 'custom_blend_enabled', o.custom_blend_enabled
      ) order by o.id)
      from public.origins o
      where o.listed
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.showcase_catalog() from public;
grant execute on function public.showcase_catalog() to anon, authenticated, service_role;

create function public.sales_open()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select c.settings -> 'salesOpen' = 'true'::jsonb from public.site_config c where c.id = 1), false);
$$;

revoke all on function public.sales_open() from public;
grant execute on function public.sales_open() to anon, authenticated, service_role;

alter policy "catalog read" on public.products using ((active and public.sales_open()) or public.is_admin());
alter policy "catalog read" on public.origins using ((active and public.sales_open()) or public.is_admin());
