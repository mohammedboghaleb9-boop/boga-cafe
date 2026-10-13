/**
 * A migration the apply tool cannot run (it holds a DELETE) is run by the owner in the SQL Editor from
 * supabase/manual/: the same text as the migration inside a transaction with its own checks. The two must never differ.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('SQL Editor blocks', () => {
  it('catalog_trim: the block holds the migration unchanged, between begin and commit', () => {
    const block = read('supabase/manual/20261013000000_catalog_trim.editor.sql');
    const migration = read('supabase/migrations/20261013000000_catalog_trim.sql').trimEnd();
    expect(block).toContain(`-- >>> 20261013000000_catalog_trim.sql\n${migration}\n-- <<< 20261013000000_catalog_trim.sql`);
    expect(block.indexOf('\nbegin;')).toBeLessThan(block.indexOf('-- >>>'));
    expect(block.indexOf('-- <<<')).toBeLessThan(block.indexOf('\ncommit;'));
    expect(block.match(/^commit;$/gm)).toHaveLength(1); // one transaction, committed once, after the checks
  });

  it('catalog_trim: the checked function bodies are the migration\'s (their md5 in the block)', async () => {
    const { createHash } = await import('node:crypto');
    const migration = read('supabase/migrations/20261013000000_catalog_trim.sql');
    const block = read('supabase/manual/20261013000000_catalog_trim.editor.sql');
    for (const name of ['save_product', 'save_origin', 'config_trim_keys']) {
      const body = new RegExp(`create or replace function public\\.${name}\\(.*?\\$\\$(.*?)\\$\\$`, 's').exec(migration)?.[1];
      expect(body, name).toBeDefined();
      expect(block, name).toContain(createHash('md5').update(body!).digest('hex'));
    }
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
    const script = read('supabase/manual/20261013000000_catalog_trim.rollback.sql');
    const before = read('supabase/migrations/20261009200000_catalog_writes.sql');
    for (const name of ['save_product', 'save_origin']) {
      expect(fn(before, name), name).toBeDefined();
      expect(script, name).toContain(fn(before, name)!);
      expect(script, `${name} md5`).toContain(await bodyMd5(before, name));
    }
    expect(script).toContain('drop function public.config_trim_keys(jsonb, text[], text[]);');
    expect(script).toContain("delete from supabase_migrations.schema_migrations where version = '20261013000000'");
    expect(commits(script)).toBe(1);
  });

  it('config_trim: restores the four bodies of settings_writes, stops while the catalog helper is there, drops the helpers in order', async () => {
    const script = read('supabase/manual/20261012230000_config_trim.rollback.sql');
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
