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
