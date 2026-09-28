/**
 * The project is split so each section can be edited on its own (docs/06-modules.md).
 * These rules keep it that way: a change that breaks them fails the tests.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..', 'src');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === '__tests__' ? [] : files(p);
    return /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

const imports = (file: string) =>
  [...readFileSync(file, 'utf8').matchAll(/from '([^']+)'|import '([^']+)'/g)].map((m) => m[1] ?? m[2]);

const all = files(SRC).map((f) => ({ path: relative(SRC, f), imports: imports(f) }));
const inside = (area: string) => all.filter((f) => f.path.startsWith(`${area}/`));

describe('module boundaries', () => {
  it('core is pure business logic: no React, no data, no services, no UI', () => {
    const bad = inside('core').flatMap((f) =>
      f.imports.filter((i) => /^react|^@\/(data|services|shared|features|i18n)/.test(i)).map((i) => `${f.path} → ${i}`),
    );
    expect(bad).toEqual([]);
  });

  it('shared, data and services never depend on a feature section', () => {
    const bad = ['shared', 'data', 'services', 'i18n'].flatMap((area) =>
      inside(area).flatMap((f) => f.imports.filter((i) => i.startsWith('@/features/')).map((i) => `${f.path} → ${i}`)),
    );
    expect(bad).toEqual([]);
  });

  it('a feature uses another feature only through its public index', () => {
    const bad = inside('features').flatMap((f) => {
      const own = f.path.split('/')[1];
      return f.imports
        .filter((i) => i.startsWith('@/features/'))
        .filter((i) => {
          const [, , other, ...rest] = i.split('/');
          return other !== own && rest.length > 0;
        })
        .map((i) => `${f.path} → ${i}`);
    });
    expect(bad).toEqual([]);
  });

  it('only the admin section imports admin code', () => {
    const bad = all
      .filter((f) => !f.path.startsWith('features/admin/') && f.path !== 'app/App.tsx')
      .flatMap((f) => f.imports.filter((i) => i.startsWith('@/features/admin')).map((i) => `${f.path} → ${i}`));
    expect(bad).toEqual([]);
  });
});
