/**
 * A migration the apply tool cannot run (it holds a DELETE) is run by the owner in the SQL Editor from
 * supabase/manual/: the same text as the migration inside a transaction with its own checks. The two must never differ.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

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

/** The migration files carry the versions recorded in live's history (read 2026-10-19), in order; a new one comes after. */
describe('migration versions', () => {
  const files = readdirSync(new URL('../supabase/migrations/', import.meta.url)).filter((f) => f.endsWith('.sql')).sort();
  const LIVE = [
    '20260927000000_init', '20261001165327_harden', '20261001180234_rate_limits', '20261001180317_quote_requests',
    '20261001180333_expiry_cron', '20261001184715_pg_net', '20261001191318_pg_net_private', '20261007005011_order_idempotency_key',
    '20261007080308_order_idempotency_commit', '20261008205033_admin_aal2', '20261009165916_quote_follow_up',
    '20261009200000_catalog_writes', '20261012183912_settings_writes', '20261013090048_config_trim', '20261013100000_catalog_trim',
    '20261016120000_catalog_ready', '20261019200936_expiry_lock_order',
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
    };
    expect(Object.keys(APPLIED)).toEqual(LIVE);
    for (const [name, sha] of Object.entries(APPLIED)) {
      expect(createHash('sha256').update(read(`supabase/migrations/${name}.sql`)).digest('hex').slice(0, 16), name).toBe(sha);
    }
  });

  it('city_shown_needs_fee: after them, a check only (no row changed), with its rollback', () => {
    expect(files.slice(LIVE.length)).toEqual(['20261020090000_city_shown_needs_fee.sql']);
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
