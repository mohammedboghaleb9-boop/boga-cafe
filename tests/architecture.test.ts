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
 * single, double or back quotes, `import x from`, `export … from`, side-effect
 * `import '…'`, dynamic `import('…')` (comments inside are ignored, e.g.
 * `import(/* @vite-ignore *\/ '…')`) and `import.meta.glob('…')`; relative
 * paths ('../b2b/Form') are resolved from the file's folder, so they obey the
 * same rules.
 */
export function importsOf(source: string, fileInSrc: string): string[] {
  // comments are skipped only where they sit inside the import itself: removing
  // every /* … */ first would let a string such as 'img/*' hide the code after it
  const gap = String.raw`\s*(?:(?:\/\*(?:[^*]|\*(?!\/))*\*\/|\/\/[^\n]*)\s*)*`;
  // a typed glob, import.meta.glob<string>(…) or glob<{ default: Page }>(…)
  const typeArg = String.raw`(?:<(?:[^<>]|<[^<>]*>)*>${gap})?`;
  const pattern = new RegExp(String.raw`(?:\bfrom${gap}|\bimport${gap}\(?${gap}|\bimport\.meta\.glob${gap}${typeArg}\(${gap}\[?${gap})(['"\`])([^'"\`]+)\1`, 'g');
  const specs = [...source.matchAll(pattern)].map((m) => m[2]);
  // every pattern of a glob list, not only the first: import.meta.glob(['./a/*', '../admin/*'])
  for (const open of source.matchAll(new RegExp(String.raw`\bimport\.meta\.glob${gap}${typeArg}\(${gap}\[`, 'g'))) {
    specs.push(...globList(source, open.index + open[0].length).slice(1));
  }
  return specs.map((spec) => {
    if (!spec.startsWith('.')) return spec;
    const inSrc = relative(SRC, resolve(SRC, dirname(fileInSrc), spec)).split(sep).join('/');
    return inSrc.startsWith('..') ? spec : `@/${inSrc}`;
  });
}

/**
 * The patterns of a glob list, read token by token from just after its '[' up
 * to the closing ']': a ']' inside a pattern ('*.[jt]sx') or a quote inside a
 * comment (// don't) does not end the list or pair with a real quote.
 */
function globList(source: string, at: number): string[] {
  const token = /\s+|,|\/\*[\s\S]*?\*\/|\/\/[^\n]*|(['"`])((?:\\[\s\S]|(?!\1)[^\\])*)\1/y;
  const found: string[] = [];
  token.lastIndex = at;
  for (let m = token.exec(source); m; m = token.exec(source)) if (m[2]) found.push(m[2]);
  return found;
}

interface Module {
  path: string;
  imports: string[];
}

/** Every broken rule, as "file → import", per rule (docs/06-modules.md). */
export function boundaryViolations(all: Module[]) {
  const inside = (area: string) => all.filter((f) => f.path.startsWith(`${area}/`));
  const list = (f: Module, bad: (i: string) => boolean) => f.imports.filter(bad).map((i) => `${f.path} → ${i}`);
  return {
    // core is pure business logic: no React, no data, no services, no UI
    core: inside('core').flatMap((f) => list(f, (i) => /^react|^@\/(data|services|shared|features|i18n)/.test(i))),
    // shared, data, services and i18n never depend on a feature section
    sharedOnFeature: ['shared', 'data', 'services', 'i18n'].flatMap((area) => inside(area).flatMap((f) => list(f, (i) => i.startsWith('@/features/')))),
    // a feature uses another feature only through its public index
    featureInternals: inside('features').flatMap((f) => {
      const own = f.path.split('/')[1];
      return list(f, (i) => {
        if (!i.startsWith('@/features/')) return false;
        const [, , other, ...rest] = i.split('/');
        return other !== own && rest.length > 0 && rest.join('/') !== 'index';
      });
    }),
    // pages reach data only through src/data/api and the hooks, never a backend itself
    // (src/server is the Edge Function's code: it reads the database directly)
    pagesThroughApi: ['app', 'features', 'shared', 'services', 'i18n'].flatMap((area) =>
      inside(area).flatMap((f) => list(f, (i) => /^@\/data\/(demo|supabase|backend|store)(\/|$)/.test(i))),
    ),
    // only the admin section imports admin code
    adminOnly: all
      .filter((f) => !f.path.startsWith('features/admin/') && f.path !== 'app/App.tsx')
      .flatMap((f) => list(f, (i) => i.startsWith('@/features/admin'))),
  };
}

const all = files(SRC).map((f) => {
  const path = relative(SRC, f).split(sep).join('/');
  return { path, imports: importsOf(readFileSync(f, 'utf8'), path) };
});

describe('module boundaries', () => {
  const found = boundaryViolations(all);
  it('core is pure business logic: no React, no data, no services, no UI', () => expect(found.core).toEqual([]));
  it('shared, data and services never depend on a feature section', () => expect(found.sharedOnFeature).toEqual([]));
  it('a feature uses another feature only through its public index', () => expect(found.featureInternals).toEqual([]));
  it('only the admin section imports admin code', () => expect(found.adminOnly).toEqual([]));
  it('pages reach data only through api and hooks, never a backend store', () => expect(found.pagesThroughApi).toEqual([]));
});

describe('the boundary checks cannot be sidestepped', () => {
  const planted = (path: string, lines: string[]) => ({ path, imports: importsOf(lines.join('\n'), path) });

  it('read every way of writing an import', () => {
    const source = [
      `import { RequestFields } from '../b2b/RequestFields';`,
      `import AdminApp from "@/features/admin/AdminApp";`,
      `const Shop = lazy(() => import('../../features/shop/ShopPage'));`,
      `export { db } from '../../data/store';`,
      `import './cart.css';`,
      `import { useState } from 'react';`,
      `const hidden = () => import(/* @vite-ignore */ '../admin/AdminApp');`,
      `const all = import.meta.glob('../admin/*.tsx');`,
      `const pattern = 'img/*';`,
      `import { Hidden } from '../admin/Hidden';`,
      `const end = '*/';`,
    ].join('\n');
    expect(importsOf(source, 'features/cart/CartPage.tsx')).toEqual([
      '@/features/b2b/RequestFields',
      '@/features/admin/AdminApp',
      '@/features/shop/ShopPage',
      '@/data/store',
      '@/features/cart/cart.css',
      'react',
      '@/features/admin/AdminApp',
      '@/features/admin/*.tsx',
      '@/features/admin/Hidden',
    ]);
  });

  it('read every pattern of a glob list, whatever sits around them', () => {
    const lists = [
      `import.meta.glob(/* pages */ ['./*.css', '../admin/*.tsx'])`,
      `import.meta.glob(\n  // pages\n  ['./*.css', '../admin/*.tsx'])`,
      `import.meta.glob(['./*.[jt]sx', '../admin/*.tsx'])`,
      `import.meta.glob([\n  './*.css',\n  // don't forget admin\n  '../admin/*.tsx',\n])`,
      `import.meta.glob<{ default: string }>(['./*.css', '../admin/*.tsx'])`,
      `import.meta.glob<Record<string, string>>('../admin/*.tsx', { eager: true })`,
    ];
    for (const list of lists) expect(importsOf(list, 'features/b2b/B2BPage.tsx'), list).toContain('@/features/admin/*.tsx');
    expect(importsOf(lists[3], 'features/b2b/B2BPage.tsx')).toEqual(['@/features/b2b/*.css', '@/features/admin/*.tsx']);
  });

  it('and each rule refuses what it must, and only that', () => {
    const found = boundaryViolations([
      planted('core/cart.ts', [`import { db } from "../data/store";`, `import { roundKg } from './money';`]),
      planted('shared/layout/Footer.tsx', [`const Shop = () => import('../../features/shop/ShopPage');`, `import { Icon } from '../ui/Icon';`]),
      planted('features/cart/CartPage.tsx', [
        `import { RequestFields } from '../b2b/RequestFields';`,
        `import { QuoteForm } from '../b2b';`,
        `import { x } from '@/features/b2b/index';`,
        `const a = () => import(/* @vite-ignore */ '../admin/AdminApp');`,
      ]),
      planted('features/shop/ShopPage.tsx', [`const pages = import.meta.glob('../admin/*.tsx');`]),
      // a string holding '/*' and a later '*/' must not hide what sits between them
      planted('shared/ui/Icon.tsx', [`const glob = 'icons/*';`, `import { Shop } from '../../features/shop/ShopPage';`, `const end = '*/';`]),
      // a line comment inside import(), and the second pattern of a glob list
      planted('features/b2b/B2BPage.tsx', [`const a = () => import(\n  // note\n  '../admin/AdminApp'\n);`, `const b = import.meta.glob(['./*.css', '../admin/*.tsx']);`]),
      planted('app/App.tsx', [`import { AdminApp } from '../features/admin/AdminApp';`]),
      // a page that reads a backend's store, however the path is written; the server may read the database
      planted('shared/layout/Header.tsx', [`import { db } from '@/data/demo/store';`, `import { useDb } from '@/data/hooks';`, `import { api } from '@/data/api';`]),
      planted('features/admin/orders/OrderDetail.tsx', [`import { db } from '../../../data/demo/store';`, `import { backend } from '@/data/backend';`]),
      planted('server/storefront.ts', [`import { loadCatalog } from '@/data/supabase/catalog';`]),
    ]);
    expect(found).toEqual({
      core: ['core/cart.ts → @/data/store'],
      sharedOnFeature: ['shared/layout/Footer.tsx → @/features/shop/ShopPage', 'shared/ui/Icon.tsx → @/features/shop/ShopPage'],
      featureInternals: [
        'features/cart/CartPage.tsx → @/features/b2b/RequestFields',
        'features/cart/CartPage.tsx → @/features/admin/AdminApp',
        'features/shop/ShopPage.tsx → @/features/admin/*.tsx',
        'features/b2b/B2BPage.tsx → @/features/admin/AdminApp',
        'features/b2b/B2BPage.tsx → @/features/admin/*.tsx',
      ],
      pagesThroughApi: [
        'features/admin/orders/OrderDetail.tsx → @/data/demo/store',
        'features/admin/orders/OrderDetail.tsx → @/data/backend',
        'shared/layout/Header.tsx → @/data/demo/store',
      ],
      adminOnly: [
        'features/cart/CartPage.tsx → @/features/admin/AdminApp',
        'features/shop/ShopPage.tsx → @/features/admin/*.tsx',
        'features/b2b/B2BPage.tsx → @/features/admin/AdminApp',
        'features/b2b/B2BPage.tsx → @/features/admin/*.tsx',
      ],
    });
  });
});
