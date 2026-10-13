-- HISTORY REPAIR (metadata only) for the trim migrations (P5 slice 11). Supabase SQL Editor, ONE transaction. NOT a migration:
-- it lives in supabase/manual/ and must never be copied into supabase/migrations/.
-- It moves the history row of catalog_trim from version 20261013000000 to 20261013100000.
-- Nothing else changes: no function, no grant, no business data, no other history row, no other column of that row.
-- WHY: catalog_trim was recorded by hand as 20261013000000, BEFORE config_trim (live 20261013090048). Replaying the files in order would run catalog_trim first and its guard
-- would stop. After the repair the history reads the same order as the files: config_trim (20261013090048), then catalog_trim (20261013100000).
--
-- STATUS: PREPARED, NOT RUN. Run it only after supervisor verification and the owner's approval, once, on the live project, after the branch that renames the files is merged.
-- Table: supabase_migrations.schema_migrations (version, statements, name, created_by, idempotency_key, rollback). The row is matched by name AND version.
--
-- HOW: paste ALL of it (from "begin;" to the last select), select nothing, press Run. Any check that fails raises an exception ("stop:") and nothing is changed.
-- EXPECTED RESULT (last select): catalog_trim_version 20261013100000, config_trim_version 20261013090048, old_version_rows 0, catalog_is_latest true, history_rows = the same number as before (15 on 2026-10-13).
-- RECOVERY: if it stops, nothing changed: read the message, fix the cause, run again. If it committed and must be reverted, run 20261013100000_catalog_trim.history-repair.undo.sql (same checks, reverse move).
-- Before running, copy the result of: select * from supabase_migrations.schema_migrations order by version;  (15 small rows) as a manual backup.
-- A concurrent change of the catalog or settings tables between "begin" and the final check would make the data check stop (safe); run again.

begin;

-- no other writer on the history table while this runs (reads stay possible), and the one row is locked
lock table supabase_migrations.schema_migrations in exclusive mode;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations where name = 'catalog_trim') <> 1
     or (select count(*) from supabase_migrations.schema_migrations where name = 'catalog_trim' and version = '20261013000000') <> 1 then
    raise exception 'stop: expected exactly one catalog_trim history row, at version 20261013000000';
  end if;
  if (select count(*) from supabase_migrations.schema_migrations where name = 'config_trim' and version = '20261013090048') <> 1
     or (select count(*) from supabase_migrations.schema_migrations where name = 'config_trim') <> 1 then
    raise exception 'stop: expected exactly one config_trim history row, at version 20261013090048';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261013100000') then
    raise exception 'stop: the destination version 20261013100000 is already in the history';
  end if;
  if '20261013100000' <= (select max(version) from supabase_migrations.schema_migrations) then
    raise exception 'stop: the destination version 20261013100000 is not later than every version in the history';
  end if;
  -- the trim functions must be the ones of the migrations (same md5 as in the editor block and the rollback scripts)
  if (select md5(replace(prosrc, E'\r', '')) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'save_product') is distinct from '70340b664e9d8244788a209a28872f72' then
    raise exception 'stop: save_product is not the body of the catalog_trim migration';
  end if;
  if (select md5(replace(prosrc, E'\r', '')) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'save_origin') is distinct from '474c8f441e0f30db554ecbaa0837a5e7' then
    raise exception 'stop: save_origin is not the body of the catalog_trim migration';
  end if;
  if (select md5(replace(prosrc, E'\r', '')) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'config_trim_keys') is distinct from '7fc5886daf56498b610a92f8d6359f3b' then
    raise exception 'stop: config_trim_keys is not the body of the catalog_trim migration';
  end if;
end $$;

-- what must stay exactly as it is
create temp table _repair_before on commit drop as
select (select count(*) from supabase_migrations.schema_migrations) as history_rows,
       (select to_jsonb(m) - 'version' from supabase_migrations.schema_migrations m where m.name = 'catalog_trim' and m.version = '20261013000000') as catalog_row_without_version,
       (select md5(coalesce(string_agg(to_jsonb(m)::text, '|' order by m.version), '')) from supabase_migrations.schema_migrations m where m.name <> 'catalog_trim') as other_rows_md5;

create function pg_temp.fp_functions() returns text language sql as $f$
  select (select md5(string_agg(p.oid::regprocedure::text || '|' || md5(replace(p.prosrc, E'\r', '')) || '|' || p.prosecdef::text || '|' || coalesce(p.proconfig::text, '-')
                                  || '|' || pg_get_userbyid(p.proowner) || '|' || coalesce(p.proacl::text, '-'), E'\n' order by p.oid::regprocedure::text))
           from pg_proc p where p.pronamespace = 'public'::regnamespace)
$f$;
create function pg_temp.fp_data() returns text language sql as $f$
  select md5(concat_ws('|',
           (select md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by to_jsonb(t)::text), '')) from public.products t),
           (select md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by to_jsonb(t)::text), '')) from public.product_recipes t),
           (select md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by to_jsonb(t)::text), '')) from public.origins t),
           (select md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by to_jsonb(t)::text), '')) from public.shipping_rates t),
           (select md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by to_jsonb(t)::text), '')) from public.payment_methods t),
           (select md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by to_jsonb(t)::text), '')) from public.site_config t),
           (select md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by to_jsonb(t)::text), '')) from public.admin_config t)))
$f$;
create temp table _repair_fp on commit drop as select pg_temp.fp_functions() as functions_md5, pg_temp.fp_data() as data_md5;

do $$
declare
  n integer;
begin
  perform 1 from supabase_migrations.schema_migrations where name = 'catalog_trim' and version = '20261013000000' for update;
  update supabase_migrations.schema_migrations set version = '20261013100000' where name = 'catalog_trim' and version = '20261013000000';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'stop: % rows updated, expected exactly 1', n;
  end if;
end $$;

do $$
declare
  b record;
  f record;
begin
  select * into b from _repair_before;
  select * into f from _repair_fp;
  if (select count(*) from supabase_migrations.schema_migrations) <> b.history_rows then
    raise exception 'stop: the number of history rows changed';
  end if;
  if (select count(*) from supabase_migrations.schema_migrations where name = 'catalog_trim' and version = '20261013100000') <> 1
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261013000000') <> 0 then
    raise exception 'stop: the catalog_trim row is not at 20261013100000 only';
  end if;
  if (select to_jsonb(m) - 'version' from supabase_migrations.schema_migrations m where m.name = 'catalog_trim') is distinct from b.catalog_row_without_version then
    raise exception 'stop: another field of the catalog_trim row changed';
  end if;
  if (select md5(coalesce(string_agg(to_jsonb(m)::text, '|' order by m.version), '')) from supabase_migrations.schema_migrations m where m.name <> 'catalog_trim') is distinct from b.other_rows_md5 then
    raise exception 'stop: another history row changed';
  end if;
  if pg_temp.fp_functions() is distinct from f.functions_md5 then
    raise exception 'stop: a function body, owner, setting or grant changed';
  end if;
  if pg_temp.fp_data() is distinct from f.data_md5 then
    raise exception 'stop: catalog or settings data changed';
  end if;
  if (select max(version) from supabase_migrations.schema_migrations) <> '20261013100000' then
    raise exception 'stop: catalog_trim is not the latest version';
  end if;
end $$;

drop function pg_temp.fp_functions();
drop function pg_temp.fp_data();

commit;

select (select version from supabase_migrations.schema_migrations where name = 'catalog_trim') as catalog_trim_version,
       (select version from supabase_migrations.schema_migrations where name = 'config_trim') as config_trim_version,
       (select count(*) from supabase_migrations.schema_migrations where version = '20261013000000') as old_version_rows,
       (select max(version) from supabase_migrations.schema_migrations) = (select version from supabase_migrations.schema_migrations where name = 'catalog_trim') as catalog_is_latest,
       (select count(*) from supabase_migrations.schema_migrations) as history_rows;
