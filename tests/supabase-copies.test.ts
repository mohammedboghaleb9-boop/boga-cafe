import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The shop reads with @supabase/postgrest-js directly (src/data/supabase/visitorClient.ts) and the Admin Panel with
 * supabase-js, which depends on the same package. Both must stay one copy: the pin in package.json is the version
 * supabase-js asks for. A Dependabot update bumps them together; if only one moves, npm nests a second copy and this fails.
 */
describe('one copy of postgrest-js', () => {
  it('the version pinned in package.json is the one supabase-js depends on', () => {
    const read = (file: string) => JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8')) as { dependencies: Record<string, string> };
    const root = read('../package.json');
    const supabase = read('../node_modules/@supabase/supabase-js/package.json');
    expect(root.dependencies['@supabase/postgrest-js']).toBe(supabase.dependencies['@supabase/postgrest-js']);
  });
});
