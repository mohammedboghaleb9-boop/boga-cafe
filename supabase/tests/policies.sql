-- P5.4 (migration 20261027100000_policies_fk_indexes): every foreign key has an index, and a table has one permissive
-- policy per role and command, with nobody's right changed: the owner reads and writes every admin row, a manager or a
-- staff member reads only its own and writes none. pgTAP, run by run-local.sh on a fresh database; the count is
-- checked against plan().
\set ON_ERROR_STOP on
set client_min_messages = warning;
create extension if not exists pgtap;

begin;
select plan(11);

insert into auth.users values ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002'),
  ('00000000-0000-0000-0000-000000000003'), ('00000000-0000-0000-0000-000000000004');
insert into public.admin_users values
  ('00000000-0000-0000-0000-000000000001', 'owner', 'Owner'),
  ('00000000-0000-0000-0000-000000000002', 'staff', 'Staff'),
  ('00000000-0000-0000-0000-000000000003', 'manager', 'Manager');

create function pg_temp.token(p_sub text, p_aal text) returns text language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', p_sub, 'aal', p_aal)::text, true)
$$;

-- ── the advisors' two findings, asked of every table (not of a list) ──
select is((select count(*)::int from pg_constraint c
            where c.contype = 'f' and c.connamespace = 'public'::regnamespace
              and not exists (select 1 from pg_index i
                               where i.indrelid = c.conrelid and (i.indkey::int2[])[0:cardinality(c.conkey) - 1] = c.conkey)),
  0, 'every foreign key of the public schema has an index that starts with its columns');
select is((select count(*)::int from (select 1 from pg_policies
            where schemaname = 'public' and permissive = 'PERMISSIVE' and cmd in ('SELECT', 'ALL')
            group by tablename having count(*) > 1) x),
  0, 'no table has two permissive policies answering a SELECT');
select is((select count(*)::int from pg_policies where schemaname = 'public' and cmd = 'ALL' and policyname in ('catalog write', 'owner manages admins')),
  0, 'the FOR ALL policies are gone');
select is((select count(*)::int from pg_policies where schemaname = 'public' and policyname in ('catalog insert', 'catalog update', 'catalog delete')), 12,
  'origins, products, product_recipes and shipping_rates: one policy per write command');

-- ── nobody's right changed ──
select pg_temp.token('00000000-0000-0000-0000-000000000001', 'aal2');
set local role authenticated;
select is((select count(*)::int from public.admin_users), 3, 'the owner reads every admin row');
select lives_ok($$insert into public.admin_users values ('00000000-0000-0000-0000-000000000004', 'staff', 'New')$$, 'the owner adds an admin');
select lives_ok($$delete from public.admin_users where user_id = '00000000-0000-0000-0000-000000000004'$$, 'the owner removes one');
reset role;
select pg_temp.token('00000000-0000-0000-0000-000000000003', 'aal2');
set local role authenticated;
select is((select count(*)::int from public.admin_users), 1, 'a manager reads only its own admin row');
select throws_ok($$insert into public.admin_users values ('00000000-0000-0000-0000-000000000004', 'owner', 'Mine')$$, '42501', null, 'a manager cannot add an admin');
reset role;
select pg_temp.token('00000000-0000-0000-0000-000000000002', 'aal1');
set local role authenticated;
select is((select count(*)::int from public.admin_users), 1, 'at the first factor only, an admin still reads its own row (the site asks for the code)');
reset role;
select pg_temp.token('00000000-0000-0000-0000-000000000001', 'aal1');
set local role authenticated;
select is((select count(*)::int from public.admin_users), 1, 'the owner at the first factor reads its own row only: the owner reading all needs the second factor');
reset role;

select * from finish(true);
rollback;
