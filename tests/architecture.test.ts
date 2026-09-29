/**
 * The project is split so each section can be edited on its own (docs/06-modules.md).
 * These rules keep it that way: a change that breaks them fails the tests.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..', 'src');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === '__tests__' ? [] : files(p);
    return /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

/**
 * Every module a source file uses, written as '@/…' whatever the spelling:
 * single or double quotes, `import x from`, `export … from`, side-effect
 * `import '…'` and dynamic `import('…')`; relative paths ('../b2b/Form') are
 * resolved from the file's folder, so they obey the same rules.
 */
export function importsOf(source: string, fileInSrc: string): string[] {
  const specs = [...source.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)(['"`])([^'"`]+)\1/g)].map((m) => m[2]);
  return specs.map((spec) => {
    if (!spec.startsWith('.')) return spec;
    const inSrc = relative(SRC, resolve(SRC, dirname(fileInSrc), spec)).split(sep).join('/');
    return inSrc.startsWith('..') ? spec : `@/${inSrc}`;
  });
}

const all = files(SRC).map((f) => {
  const path = relative(SRC, f).split(sep).join('/');
  return { path, imports: importsOf(readFileSync(f, 'utf8'), path) };
});
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
          return other !== own && rest.length > 0 && rest.join('/') !== 'index';
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

describe('the boundary checks cannot be sidestepped', () => {
  it('see relative, double-quoted, dynamic and re-exported imports', () => {
    const source = [
      `import { SampleRequestForm } from '../b2b/SampleRequestForm';`,
      `import AdminApp from "@/features/admin/AdminApp";`,
      `const Shop = lazy(() => import('../../features/shop/ShopPage'));`,
      `export { db } from '../../data/store';`,
      `import './cart.css';`,
      `import { useState } from 'react';`,
    ].join('\n');
    expect(importsOf(source, 'features/cart/CartPage.tsx')).toEqual([
      '@/features/b2b/SampleRequestForm',
      '@/features/admin/AdminApp',
      '@/features/shop/ShopPage',
      '@/data/store',
      '@/features/cart/cart.css',
      'react',
    ]);
    expect(importsOf(`import { db } from "../data/store";`, 'core/cart.ts')).toEqual(['@/data/store']);
  });
});
