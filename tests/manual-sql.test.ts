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
