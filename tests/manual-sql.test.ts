/**
 * A migration the apply tool cannot run (it holds a DELETE) is run by the owner in the SQL Editor from
 * supabase/manual/: the same text as the migration inside a transaction with its own checks. The two must never differ.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

/** Written, reviewed and merged before it is applied on live (owner 2026-10-21: merge, then the SQL Editor block). */
const PENDING: string[] = ['20261028090000_outbox_sender'];

describe('SQL Editor blocks', () => {
  it('catalog_trim: the block holds the migration unchanged, between begin and commit', () => {
    const block = read('supabase/manual/20261013100000_catalog_trim.editor.sql');
    const migration = read('supabase/migrations/20261013100000_catalog_trim.sql').trimEnd();
    expect(block).toContain(`-- >>> 20261013100000_catalog_trim.sql\n${migration}\n-- <<< 20261013100000_catalog_trim.sql`);
    expect(block.indexOf('\nbegin;')).toBeLessThan(block.indexOf('-- >>>'));
    expect(block.indexOf('-- <<<')).toBeLessThan(block.indexOf('\ncommit;'));
    expect(block.match(/^commit;$/gm)).toHaveLength(1); // one transaction, committed once, after the checks
  });

  it('catalog_trim: the checked function bodies are the migration\'s (their md5 in the block)', async () => {
    const { createHash } = await import('node:crypto');
    const migration = read('supabase/migrations/20261013100000_catalog_trim.sql');
    const block = read('supabase/manual/20261013100000_catalog_trim.editor.sql');
    for (const name of ['save_product', 'save_origin', 'config_trim_keys']) {
      const body = new RegExp(`create or replace function public\\.${name}\\(.*?\\$\\$(.*?)\\$\\$`, 's').exec(migration)?.[1];
      expect(body, name).toBeDefined();
      expect(block, name).toContain(createHash('md5').update(body!).digest('hex'));
    }
  });
});

/** The history repair moves one metadata row (catalog_trim 20261013000000 -> 20261013100000); its undo moves it back. Neither may touch anything else. */
describe('history repair scripts', () => {
  const repair = read('supabase/manual/20261013100000_catalog_trim.history-repair.sql');
  const undo = read('supabase/manual/20261013100000_catalog_trim.history-repair.undo.sql');
  const updateOf = (script: string) => /update supabase_migrations\.schema_migrations set version = '(\d+)' where name = 'catalog_trim' and version = '(\d+)';/.exec(script);

  it('the versions are in the right order: config_trim, then catalog_trim, in the files and in the history after the repair', () => {
    const files = readdirSync(new URL('../supabase/migrations/', import.meta.url)).filter((f) => f.endsWith('.sql'));
    expect(files.filter((f) => /_(config_trim|catalog_trim)\.sql$/.test(f)).sort()).toEqual(['20261013090048_config_trim.sql', '20261013100000_catalog_trim.sql']);
    expect(updateOf(repair)?.slice(1)).toEqual(['20261013100000', '20261013000000']); // new version, old version
    const version = (suffix: string) => files.find((f) => f.endsWith(suffix))!.slice(0, 14);
    const [newVersion, oldVersion] = updateOf(repair)!.slice(1);
    expect(version('_catalog_trim.sql') > version('_config_trim.sql')).toBe(true); // replay order = history order
    expect(newVersion).toBe(version('_catalog_trim.sql'));
    expect(oldVersion < version('_config_trim.sql')).toBe(true); // the order the history has today, which the repair ends
  });

  it('forward and undo: one transaction, locked, exactly one row updated, destination absent, everything else compared before the commit', () => {
    expect(updateOf(undo)?.slice(1)).toEqual(['20261013000000', '20261013100000']); // the reverse move
    for (const script of [repair, undo]) {
      expect(script.match(/^begin;$/gm)).toHaveLength(1);
      expect(script.match(/^commit;$/gm)).toHaveLength(1);
      const lock = script.indexOf('lock table supabase_migrations.schema_migrations in exclusive mode;');
      expect(lock).toBeGreaterThan(script.indexOf('\nbegin;'));
      expect(lock).toBeLessThan(script.indexOf('update supabase_migrations.schema_migrations'));
      expect(script.match(/update supabase_migrations\.schema_migrations/g)).toHaveLength(1); // the only write
      expect(script).toContain('<> 1 then\n    raise exception \'stop: % rows updated, expected exactly 1\'');
      expect(script).toContain("where name = 'config_trim' and version = '20261013090048') <> 1");
      for (const check of ['the number of history rows changed', 'another field of the catalog_trim row changed', 'another history row changed', 'a function body, owner, setting or grant changed', 'catalog or settings data changed']) {
        expect(script.indexOf(check), check).toBeGreaterThan(script.indexOf('update supabase_migrations'));
        expect(script.indexOf(check), check).toBeLessThan(script.indexOf('\ncommit;'));
      }
      expect(script).not.toMatch(/\b(delete|insert|drop table|truncate)\b[^\n]*schema_migrations/i);
    }
    expect(repair).toContain("version = '20261013100000') then\n    raise exception 'stop: the destination version 20261013100000 is already in the history'");
    expect(repair).toContain("'20261013100000' <= (select max(version)"); // strictly later than every existing version
  });

  it('forward: the three trim function bodies it requires are the migration\'s (md5)', async () => {
    const { createHash } = await import('node:crypto');
    const migration = read('supabase/migrations/20261013100000_catalog_trim.sql');
    for (const name of ['save_product', 'save_origin', 'config_trim_keys']) {
      const body = new RegExp(`create or replace function public\\.${name}\\(.*?\\$\\$(.*?)\\$\\$`, 's').exec(migration)?.[1];
      expect(repair, name).toContain(createHash('md5').update(body!).digest('hex'));
    }
  });

  it('the repair is never in the normal migration sequence', () => {
    const files = readdirSync(new URL('../supabase/migrations/', import.meta.url));
    expect(files.filter((f) => /history|repair/i.test(f))).toEqual([]);
  });
});

/** A rollback restores the functions of the migration before; they must be that migration's text, unchanged. */
describe('rollback scripts', () => {
  const fn = (sql: string, name: string) => new RegExp(`create or replace function public\\.${name}\\(.*?\\nend \\$\\$;\\n`, 's').exec(sql)?.[0];
  const bodyMd5 = async (sql: string, name: string) => {
    const { createHash } = await import('node:crypto');
    const body = new RegExp(`create or replace function public\\.${name}\\(.*?\\$\\$(.*?)\\$\\$`, 's').exec(sql)?.[1];
    return createHash('md5').update(body!.replace(/\r/g, '')).digest('hex');
  };
  const commits = (script: string) => script.match(/^commit;$/gm)?.length;

  it('catalog_trim: restores the two bodies of catalog_writes, drops the helper, forgets its version, one commit', async () => {
    const script = read('supabase/manual/20261013100000_catalog_trim.rollback.sql');
    const before = read('supabase/migrations/20261009200000_catalog_writes.sql');
    for (const name of ['save_product', 'save_origin']) {
      expect(fn(before, name), name).toBeDefined();
      expect(script, name).toContain(fn(before, name)!);
      expect(script, `${name} md5`).toContain(await bodyMd5(before, name));
    }
    expect(script).toContain('drop function public.config_trim_keys(jsonb, text[], text[]);');
    expect(script).toContain("where name = 'catalog_trim' and version in ('20261013000000', '20261013100000')"); // the version before and after the history repair
    expect(commits(script)).toBe(1);
  });

  it('config_trim: restores the four bodies of settings_writes, stops while the catalog helper is there, drops the helpers in order', async () => {
    const script = read('supabase/manual/20261013090048_config_trim.rollback.sql');
    const before = read('supabase/migrations/20261012183912_settings_writes.sql');
    for (const name of ['save_content', 'save_recipients', 'save_payment_method', 'save_shipping_rate']) {
      expect(fn(before, name), name).toBeDefined();
      expect(script, name).toContain(fn(before, name)!);
      expect(script, `${name} md5`).toContain(await bodyMd5(before, name));
    }
    // the catalog saves call config_trim_keys -> config_trim_text -> config_trim_str: undone in that order, never the reverse
    expect(script.indexOf("to_regprocedure('public.config_trim_keys(jsonb, text[], text[])') is not null")).toBeGreaterThan(-1);
    expect(script.indexOf('drop function public.config_trim_text(jsonb);')).toBeLessThan(script.indexOf('drop function public.config_trim_str(jsonb);'));
    expect(script).toContain("delete from supabase_migrations.schema_migrations where version = '20261013090048'");
    expect(commits(script)).toBe(1);
  });
});

/** Slice 12: the SQL Editor block holds the migration unchanged; the rollback undoes the catalog part only and keeps the sales gate. */
describe('catalog_ready (slice 12)', () => {
  const migration = read('supabase/migrations/20261016120000_catalog_ready.sql');
  const block = read('supabase/manual/20261016120000_catalog_ready.editor.sql');
  const rollback = read('supabase/manual/20261016120000_catalog_ready.rollback.sql');
  const md5 = async (text: string) => (await import('node:crypto')).createHash('md5').update(text).digest('hex');
  const body = (sql: string, name: string) => new RegExp(`create (?:or replace )?function public\\.${name}\\(.*?\\$\\$(.*?)\\$\\$`, 's').exec(sql)?.[1];
  const fn = (sql: string, name: string) => new RegExp(`create or replace function public\\.${name}\\(.*?\\nend \\$\\$;`, 's').exec(sql)?.[0];

  it('the block holds the migration unchanged, between begin and its one commit, after the guards', () => {
    expect(block).toContain(`-- >>> 20261016120000_catalog_ready.sql\n${migration.trimEnd()}\n-- <<< 20261016120000_catalog_ready.sql`);
    expect(block.indexOf('\nbegin;')).toBeLessThan(block.indexOf("stop: 20261016120000_catalog_ready is already applied"));
    expect(block.indexOf("stop: 20261016120000_catalog_ready is already applied")).toBeLessThan(block.indexOf('-- >>>'));
    expect(block.indexOf('-- <<<')).toBeLessThan(block.indexOf('\ncommit;'));
    expect(block.match(/^commit;$/gm)).toHaveLength(1);
  });

  it('the block checks the seven bodies of the migration (md5) and that no row changed', async () => {
    for (const name of ['check_order', 'commit_order', 'commit_quote_request', 'save_origin', 'save_shipping_rate', 'set_sales_open', 'save_product']) {
      expect(body(migration, name), name).toBeDefined();
      expect(block, name).toContain(await md5(body(migration, name)!));
    }
    expect(block).toContain("raise exception 'stop: a catalog, delivery, payment-method or settings row changed");
    expect(block).toContain("set local lock_timeout = '3s';");
    expect(block).toContain('stop: a function on live is not the one of the earlier migrations');
  });

  it("save_product is catalog_trim's with the lock on the shown product's origins, nothing else", async () => {
    const trim = read('supabase/migrations/20261013100000_catalog_trim.sql');
    const lock = /  -- the recipe's origins, locked first.*?order by o\.id for key share;\n/s;
    const locked = fn(migration, 'save_product')!;
    expect(locked.match(lock)?.[0]).toBeDefined();
    // the lock comes before the 'hidden_origin' check and before the recipe is written
    expect(locked.search(lock)).toBeLessThan(locked.indexOf("raise exception 'hidden_origin'"));
    expect(locked.replace(lock, '')).toBe(fn(trim, 'save_product')!);
    // before applying, the block accepts exactly catalog_trim's save_product (or this one, after a rollback)
    expect(block).toContain(await md5(body(trim, 'save_product')!));
    // save_origin locks its row before every check of an edit
    const origin = fn(migration, 'save_origin')!;
    expect(origin.indexOf('for update;')).toBeGreaterThan(origin.indexOf('  else\n'));
    expect(origin.indexOf('for update;')).toBeLessThan(origin.indexOf("raise exception 'needs_price'"));
    expect(origin.indexOf('for update;')).toBeLessThan(origin.indexOf("raise exception 'origin_in_use'"));
  });

  it('the migration changes no row: no insert, update or delete outside its function bodies', () => {
    const outside = migration.replace(/\$\$.*?\$\$/gs, '');
    expect(outside).not.toMatch(/\b(insert into|update public\.|delete from)\b/i);
  });

  it('the rollback restores save_origin and save_shipping_rate of their migrations, check_order without the cap, and keeps the gate', async () => {
    const trim = read('supabase/migrations/20261013100000_catalog_trim.sql');
    const config = read('supabase/migrations/20261013090048_config_trim.sql');
    expect(rollback).toContain(fn(trim, 'save_origin')!);
    expect(rollback).toContain(await md5(body(trim, 'save_origin')!));
    expect(rollback).toContain(fn(config, 'save_shipping_rate')!);
    expect(rollback).toContain(await md5(body(config, 'save_shipping_rate')!));
    const check = fn(rollback, 'check_order')!;
    expect(check).not.toContain('max_fee');
    expect(check).toContain("raise exception 'sales_closed'"); // the gate stays: undoing it would open the sales
    expect(check.replace(/ *v_fee := round\(v_rate\.base_fee \+ v_extra_kg \* v_rate\.extra_per_kg\);\n/, '')).toBe(
      fn(migration, 'check_order')!.replace(/ *-- at most the city's cap.*\n *v_fee := round\(least\(.*\)\);\n/, ''),
    ); // the migration's check_order but the cap, nothing else
    for (const name of ['commit_order', 'commit_quote_request', 'set_sales_open', 'save_product']) {
      expect(rollback, name).not.toMatch(new RegExp(`function public\\.${name}\\(`));
      expect(rollback, `${name} still checked`).toContain(await md5(body(migration, name)!));
    }
    expect(rollback).toContain('stop: % origin(s) without a price');
    expect(rollback).toContain('stop: % city(ies) with a delivery cap');
    expect(rollback.match(/^commit;$/gm)).toHaveLength(1);
  });
});

describe('expiry_lock_order (the expiry cron in the orders\' lock order)', () => {
  const migration = read('supabase/migrations/20261019200936_expiry_lock_order.sql');
  const rollback = read('supabase/manual/20261019200936_expiry_lock_order.rollback.sql');
  const init = read('supabase/migrations/20260927000000_init.sql');
  // without CR, as the guards compare it (md5(replace(prosrc, E'\r', ''))): a CRLF checkout gives the same digest
  const md5 = async (text: string) => (await import('node:crypto')).createHash('md5').update(text.replace(/\r/g, '')).digest('hex');
  const body = (sql: string) => /create or replace function public\.expire_unpaid_orders\(.*?\$\$(.*?)\$\$/s.exec(sql)?.[1];
  const fn = (sql: string) => /create or replace function public\.expire_unpaid_orders\(.*?\nend \$\$;/s.exec(sql)?.[0];

  it('replaces only init\'s function or itself (md5 guard), and changes no row', async () => {
    expect(migration).toContain(`'${await md5(body(init)!)}', '${await md5(body(migration)!)}'`);
    expect(migration.indexOf("raise exception 'stop:")).toBeLessThan(migration.indexOf('create or replace function'));
    // a missing function stops it too (md5 of nothing is NULL, and NULL not in (...) would let it through)
    expect(migration).toMatch(/if coalesce\(\(select md5\(replace\(prosrc, E'\\r', ''\)\) from pg_proc .*?\), ''\)\s+not in \(/s);
    // the rights as init set them, whatever the database's default privileges
    expect(migration).toMatch(
      /revoke all on function public\.expire_unpaid_orders\(\) from public, anon, authenticated;\ngrant execute on function public\.expire_unpaid_orders\(\) to service_role;\n$/,
    );
    const outside = migration.replace(/\$\$.*?\$\$/gs, '');
    expect(outside).not.toMatch(/\b(insert into|update public\.|delete from|drop )/i);
  });

  it('locks the orders (skip locked), then every origin in id order, before any stock is given back', () => {
    const b = body(migration)!;
    const orders = b.search(/order by o\.created_at\s+for update skip locked/);
    // the origins of the locked orders whose stock is not back yet, all in one statement
    const origins = b.search(
      /perform 1 from public\.origins o\s+where o\.id in \(select x ->> 'originId'\s+from public\.orders r, jsonb_array_elements\(r\.stock_deductions\) x\s+where r\.id = any\(v_ids\) and not r\.stock_returned\)\s+order by o\.id\s+for no key update;/,
    );
    expect(orders).toBeGreaterThan(-1);
    expect(origins).toBeGreaterThan(orders);
    expect(origins).toBeLessThan(b.indexOf('for v_order in'));
    expect(b.indexOf('for v_order in')).toBeLessThan(b.indexOf('update public.origins set stock_kg'));
  });

  it('gives the stock back exactly as init did (once, one history line per origin, one status.expired)', () => {
    const steps = /    if not v_order\.stock_returned then.*?values \(v_order\.id, 'status\.expired'\);\n/s;
    const before = body(init)!.match(steps)?.[0];
    expect(before).toBeDefined();
    expect(body(migration)!.match(steps)?.[0]).toBe(before);
  });

  it('the rollback puts init\'s function back, guarded by both md5s, in one commit', async () => {
    expect(rollback).toContain(fn(init)!);
    expect(rollback).toContain(await md5(body(migration)!));
    expect(rollback).toContain(await md5(body(init)!));
    expect(rollback.match(/^commit;$/gm)).toHaveLength(1);
  });
});

/** The migration files carry the versions recorded in live's history (read 2026-10-20: 18 rows), in order; a new one comes after. */
describe('migration versions', () => {
  const files = readdirSync(new URL('../supabase/migrations/', import.meta.url)).filter((f) => f.endsWith('.sql')).sort();
  const LIVE = [
    '20260927000000_init', '20261001165327_harden', '20261001180234_rate_limits', '20261001180317_quote_requests',
    '20261001180333_expiry_cron', '20261001184715_pg_net', '20261001191318_pg_net_private', '20261007005011_order_idempotency_key',
    '20261007080308_order_idempotency_commit', '20261008205033_admin_aal2', '20261009165916_quote_follow_up',
    '20261009200000_catalog_writes', '20261012183912_settings_writes', '20261013090048_config_trim', '20261013100000_catalog_trim',
    '20261016120000_catalog_ready', '20261019200936_expiry_lock_order', '20261020090000_city_shown_needs_fee',
    '20261021120000_catalog_showcase', '20261027090000_quote_lines_for_sale', '20261027100000_policies_fk_indexes',
  ];

  it('the applied ones are named as live recorded them (the expiry fix: 20261019200936, the apply tool\'s version)', () => {
    expect(files.slice(0, LIVE.length).map((f) => f.replace(/\.sql$/, ''))).toEqual(LIVE);
  });

  it('an applied migration is never rewritten: each file keeps the text it had when it was applied (sha256 prefix)', async () => {
    const { createHash } = await import('node:crypto');
    const APPLIED: Record<string, string> = {
    '20260927000000_init': 'c6d2c5240ca7abd1',
    '20261001165327_harden': 'cbd161b15d9a4254',
    '20261001180234_rate_limits': 'd3bf445d679a4e54',
    '20261001180317_quote_requests': 'fe7333441b108693',
    '20261001180333_expiry_cron': 'c83c8a2a00dcb421',
    '20261001184715_pg_net': 'dea2536df83767c4',
    '20261001191318_pg_net_private': '7b454009c95caa66',
    '20261007005011_order_idempotency_key': '7180e1aca4a3f55d',
    '20261007080308_order_idempotency_commit': 'a6ec2033b6b00789',
    '20261008205033_admin_aal2': '10585025ffd8fba0',
    '20261009165916_quote_follow_up': '828979f2587d7c67',
    '20261009200000_catalog_writes': '6a1cf24f0966679f',
    '20261012183912_settings_writes': 'ca3213335c36c2e3',
    '20261013090048_config_trim': 'fcd6ac5bbe1f35b0',
    '20261013100000_catalog_trim': 'fc2b85d1bdbfdcb9',
    '20261016120000_catalog_ready': '55ea7116397183b0',
    '20261019200936_expiry_lock_order': '443b936370fc0352',
    '20261020090000_city_shown_needs_fee': 'afd8c508c4bd8886',
    '20261021120000_catalog_showcase': '089ac8c1a3a84bc5',
    '20261027090000_quote_lines_for_sale': 'bd955b2ebb19b77a',
    '20261027100000_policies_fk_indexes': '34c0638c8dd044f9',
    };
    expect(Object.keys(APPLIED)).toEqual(LIVE);
    for (const [name, sha] of Object.entries(APPLIED)) {
      expect(createHash('sha256').update(read(`supabase/migrations/${name}.sql`)).digest('hex').slice(0, 16), name).toBe(sha);
    }
  });

  it('only the reviewed pending migration waits to be applied: every other one is in live\'s history', () => {
    expect(files.slice(LIVE.length).map((f) => f.replace(/\.sql$/, ''))).toEqual(PENDING);
  });

  it('city_shown_needs_fee (applied 2026-10-20 by its SQL Editor block): a check only (no row changed), with its rollback', () => {
    const sql = read('supabase/migrations/20261020090000_city_shown_needs_fee.sql').replace(/^--.*$/gm, '');
    expect(sql.trim()).toBe('alter table public.shipping_rates\n  add constraint shipping_rates_shown_needs_fee check (not active or base_fee > 0);');
    const block = read('supabase/manual/20261020090000_city_shown_needs_fee.editor.sql');
    const migration = read('supabase/migrations/20261020090000_city_shown_needs_fee.sql').trimEnd();
    expect(block).toContain(`-- >>> 20261020090000_city_shown_needs_fee.sql\n${migration}\n-- <<< 20261020090000_city_shown_needs_fee.sql`);
    expect(block.indexOf('\nbegin;')).toBeLessThan(block.indexOf("raise exception 'stop:"));
    expect(block.indexOf("raise exception 'stop:")).toBeLessThan(block.indexOf('-- >>>'));
    // the file's own version, recorded once, inside the same transaction
    expect(block.match(/insert into supabase_migrations\.schema_migrations \(version, name\) values \('20261020090000', 'city_shown_needs_fee'\);/g)).toHaveLength(1);
    expect(block.indexOf('-- <<<')).toBeLessThan(block.indexOf('insert into supabase_migrations'));
    expect(block.indexOf('insert into supabase_migrations')).toBeLessThan(block.indexOf('\ncommit;'));
    expect(block.match(/^commit;$/gm)).toHaveLength(1);
    expect(read('supabase/manual/20261020090000_city_shown_needs_fee.rollback.sql')).toContain(
      'alter table public.shipping_rates drop constraint shipping_rates_shown_needs_fee;',
    );
  });
});

describe('catalog_showcase (the catalog shown without prices, owner 2026-10-21)', () => {
  const migration = read('supabase/migrations/20261021120000_catalog_showcase.sql').trimEnd();
  const block = read('supabase/manual/20261021120000_catalog_showcase.editor.sql');
  const listing = read('supabase/manual/20261021120000_catalog_showcase.listing.sql');

  it('the editor block holds the migration unchanged, after its guards, with its version, in one commit', () => {
    expect(block).toContain(`-- >>> 20261021120000_catalog_showcase.sql\n${migration}\n-- <<< 20261021120000_catalog_showcase.sql`);
    expect(block.indexOf('\nbegin;')).toBeLessThan(block.indexOf("raise exception 'stop:"));
    expect(block.indexOf("raise exception 'stop:")).toBeLessThan(block.indexOf('-- >>>'));
    expect(block.match(/insert into supabase_migrations\.schema_migrations \(version, name\) values \('20261021120000', 'catalog_showcase'\);/g)).toHaveLength(1);
    expect(block.indexOf('-- <<<')).toBeLessThan(block.indexOf('insert into supabase_migrations'));
    expect(block.match(/^commit;$/gm)).toHaveLength(1);
  });

  it('the migration lists nothing and writes no row: two columns false by default, one read function', () => {
    const sql = migration.replace(/^--.*$/gm, '');
    expect(sql).not.toMatch(/\b(insert|update|delete)\b/i);
    expect(sql.match(/add column listed boolean not null default false;/g)).toHaveLength(2);
    expect(sql).toMatch(/security definer\nset search_path = public, pg_temp/);
    expect(sql).toContain('revoke all on function public.showcase_catalog() from public;');
    // no price leaves the database while the sales are closed: visitors read the rows for sale only once they open
    expect(sql).toContain('alter policy "catalog read" on public.products using ((active and public.sales_open()) or public.is_admin());');
    expect(sql).toContain('alter policy "catalog read" on public.origins using ((active and public.sales_open()) or public.is_admin());');
    expect(block).toContain("and qual = '(active OR is_admin())') <> 2 then"); // replaces init's rules only
  });

  it('the listing block lists exactly the 16 compared rows, and stops on any other catalog', () => {
    const ids = (name: string) => JSON.parse(`[${new RegExp(`v_${name} text\\[\\] := array\\[([^\\]]*)\\]`, 's').exec(listing)![1].replace(/'/g, '"')}]`);
    expect(ids('products')).toEqual(['boga-signature', 'douceur-arabica', 'horeca-crema-forte', 'horeca-espresso-bar', 'horeca-premium-arabica',
      'oriental-intense', 'so-brazil', 'so-colombia', 'so-ethiopia', 'so-honduras']);
    expect(ids('origins')).toEqual(['brazil', 'colombia', 'ethiopia', 'honduras', 'uganda', 'vietnam']);
    // the fingerprint read on live on 2026-10-21 (and given by supabase/seed.sql: tests/showcase-listing.sh)
    expect(listing).toContain("v_fingerprint is distinct from 'd8ad4e21d30eeba84bc109c635204f3e'");
    // its only writes are the flag, after every check
    expect(listing.match(/\bupdate public\.\w+ set [^;]*;/g)).toEqual([
      'update public.products set listed = true where id = any (v_products) and not listed;',
      'update public.origins set listed = true where id = any (v_origins) and not listed;',
    ]);
    for (const stop of ['is not applied', 'not the 10 compared', 'not the 6 compared', 'fingerprint', 'not the 22 compared', 'already listed', 'for sale (active)']) {
      expect(listing.indexOf(stop), stop).toBeGreaterThan(0);
      expect(listing.indexOf(stop), stop).toBeLessThan(listing.indexOf('update public.products set listed'));
    }
    expect(listing.match(/^commit;$/gm)).toHaveLength(1);
  });

  it('the production build reads the display only once the migration is applied (merge first, then the database, then the flag)', () => {
    // while pending, the site must not ask for a function live does not have (the flag is turned on after the apply)
    const flagOn = /^VITE_SHOWCASE=on$/m.test(read('.env.workers-preview'));
    expect(flagOn && PENDING.includes('20261021120000_catalog_showcase')).toBe(false);
  });

  it('the undo touches the flag only; the rollback puts back what the migration changed', () => {
    expect(read('supabase/manual/20261021120000_catalog_showcase.unlist.sql').match(/\bupdate [^;]*;/g)).toEqual([
      'update public.products set listed = false where listed;',
      'update public.origins set listed = false where listed;',
    ]);
    const rollback = read('supabase/manual/20261021120000_catalog_showcase.rollback.sql');
    expect(rollback.match(/^(drop|alter) [^;]*;/gm)).toEqual([
      'alter policy "catalog read" on public.products using (active or public.is_admin());',
      'alter policy "catalog read" on public.origins using (active or public.is_admin());',
      'drop function public.sales_open();',
      'drop function public.showcase_catalog();',
      'alter table public.products drop column listed;',
      'alter table public.origins drop column listed;',
    ]);
  });
});

describe('policies_fk_indexes (P5.4: foreign-key indexes, one permissive policy per command)', () => {
  const migration = read('supabase/migrations/20261027100000_policies_fk_indexes.sql').trimEnd();
  const block = read('supabase/manual/20261027100000_policies_fk_indexes.editor.sql');
  const rollback = read('supabase/manual/20261027100000_policies_fk_indexes.rollback.sql');

  it('the editor block holds the migration unchanged, after its guards, with its version, in one commit', () => {
    expect(block).toContain(`-- >>> 20261027100000_policies_fk_indexes.sql\n${migration}\n-- <<< 20261027100000_policies_fk_indexes.sql`);
    expect(block.indexOf('\nbegin;')).toBeLessThan(block.indexOf("raise exception 'stop:"));
    expect(block.indexOf("raise exception 'stop:")).toBeLessThan(block.indexOf('-- >>>'));
    expect(block.match(/insert into supabase_migrations\.schema_migrations \(version, name\) values \('20261027100000', 'policies_fk_indexes'\);/g)).toHaveLength(1);
    expect(block.indexOf('-- <<<')).toBeLessThan(block.indexOf('insert into supabase_migrations'));
    expect(block.match(/^commit;$/gm)).toHaveLength(1);
  });

  it('changes no row: indexes and policies only; every FOR ALL policy it drops is given back by the rollback', () => {
    const sql = migration.replace(/^--.*$/gm, '');
    expect(sql).not.toMatch(/\b(insert|update|delete|truncate)\s+(into|from)?\s*public\./i);
    const dropped = [...sql.matchAll(/drop policy "([^"]+)" on public\.(\w+);/g)].map((m) => `${m[2]}:${m[1]}`);
    expect(dropped).toEqual([
      'origins:catalog write',
      'products:catalog write',
      'product_recipes:catalog write',
      'shipping_rates:catalog write',
      'admin_users:owner manages admins',
    ]);
    for (const d of dropped) {
      const [table, policy] = d.split(':');
      expect(rollback).toContain(`create policy "${policy}" on public.${table} for all`);
    }
    for (const idx of ['orders_city_id_idx', 'orders_payment_method_idx', 'quote_requests_city_id_idx']) {
      expect(sql).toContain(`create index ${idx} on public.`);
      expect(rollback).toContain(`drop index public.${idx};`);
    }
  });
});

describe('outbox_sender (P5.1: the sender\'s two functions and its schedule)', () => {
  const migration = read('supabase/migrations/20261028090000_outbox_sender.sql');
  const sql = migration.replace(/^--.*$/gm, '');
  const rollback = read('supabase/manual/20261028090000_outbox_sender.rollback.sql');
  const cron = read('supabase/manual/20261028090000_outbox_cron.sql');

  it('the migration drops nothing (so the migration tool can run it) and shuts the two functions to everyone but the server role', () => {
    expect(sql).not.toMatch(/\bdrop\b/i);
    expect(sql).toContain('revoke all on function public.claim_outbox(integer, text[]) from public, anon, authenticated;');
    expect(sql).toContain('revoke all on function public.finish_outbox(bigint, boolean, text) from public, anon, authenticated;');
    expect(sql).toContain('grant execute on function public.claim_outbox(integer, text[]) to service_role;');
    expect(sql).toContain('grant execute on function public.finish_outbox(bigint, boolean, text) to service_role;');
  });

  it('the rollback takes back what the migration made', () => {
    expect(rollback).toContain('drop function public.claim_outbox(integer, text[]);');
    expect(rollback).toContain('drop function public.finish_outbox(bigint, boolean, text);');
    expect(rollback).toContain('drop column last_attempt_at');
  });

  it('the schedule holds no key (it is read from Vault at each run), has its off switch, and calls this project\'s function only', () => {
    const code = cron.replace(/^--.*$/gm, '');
    expect(code).toContain("select decrypted_secret from vault.decrypted_secrets where name = 'outbox_key'");
    expect(cron).toContain("select cron.unschedule('send-outbox');");
    expect(code).toContain("url := 'https://ldzagzskfmnjbkizbayr.supabase.co/functions/v1/notify-outbox'");
    // no value that looks like a key or a token
    expect(code).not.toMatch(/eyJ|[A-Za-z0-9_-]{32,}/);
  });
});
