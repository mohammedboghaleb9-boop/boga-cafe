-- SQL Editor block for 20261021120000_catalog_showcase (P5, owner 2026-10-21: the catalog shown without prices).
-- WHEN: after the PR is merged into main, before the site reads the showcase (VITE_SHOWCASE stays off until then).
-- WHAT IT CHANGES: a `listed` column on products and origins, false for every row (nothing is shown yet), and the
-- public read showcase_catalog(). NO ROW changes: no price, stock, sale switch or setting. Then the version is
-- recorded once in the migration history (the file's own version, as for 20261020090000).
-- HOW: paste ALL of it (from "begin;" to the last select), select nothing, press Run. One transaction: any check that
-- fails raises "stop: ..." and nothing is changed. The text between the two markers is the migration file unchanged
-- (tests/manual-sql.test.ts keeps them equal).
-- RESULT: the last select reads columns 2, listed_rows 0, definer true, path_set true, anon_can_run true,
-- public_can_run false, history_rows 1.
-- NEXT (its own approval): supabase/manual/20261021120000_catalog_showcase.listing.sql lists the 16 compared rows.
-- ROLLBACK (after a commit): supabase/manual/20261021120000_catalog_showcase.rollback.sql, then remove the history row.

begin;
set local lock_timeout = '3s';

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name in ('products', 'origins') and column_name = 'listed') then
    raise exception 'stop: a listed column is already there (nothing to do): tell Claude';
  end if;
  if to_regprocedure('public.showcase_catalog()') is not null then
    raise exception 'stop: showcase_catalog() is already there: tell Claude';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261021120000') then
    raise exception 'stop: 20261021120000 is already in the history: tell Claude';
  end if;
  if (select max(version) from supabase_migrations.schema_migrations) is distinct from '20261020090000' then
    raise exception 'stop: the history does not end at 20261020090000_city_shown_needs_fee: tell Claude';
  end if;
end $$;

-- >>> 20261021120000_catalog_showcase.sql
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
-- <<< 20261021120000_catalog_showcase.sql

insert into supabase_migrations.schema_migrations (version, name) values ('20261021120000', 'catalog_showcase');

commit;

-- result, after the commit (nothing else is selected)
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name in ('products', 'origins') and column_name = 'listed') as columns,
  (select count(*) from public.products where listed) + (select count(*) from public.origins where listed) as listed_rows,
  (select prosecdef from pg_proc where oid = 'public.showcase_catalog()'::regprocedure) as definer,
  (select proconfig @> array['search_path=public, pg_temp'] from pg_proc where oid = 'public.showcase_catalog()'::regprocedure) as path_set,
  has_function_privilege('anon', 'public.showcase_catalog()', 'execute') as anon_can_run,
  exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = 'public.showcase_catalog()'::regprocedure and a.grantee = 0) as public_can_run,
  (select count(*) from supabase_migrations.schema_migrations where version = '20261021120000') as history_rows;
