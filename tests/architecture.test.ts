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
  const code = source.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const specs = [
    ...code.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*|\bimport\.meta\.glob\s*\(\s*\[?\s*)(['"`])([^'"`]+)\1/g),
  ].map((m) => m[2]);
  return specs.map((spec) => {
    if (!spec.startsWith('.')) return spec;
    const inSrc = relative(SRC, resolve(SRC, dirname(fileInSrc), spec)).split(sep).join('/');
    return inSrc.startsWith('..') ? spec : `@/${inSrc}`;
  });
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
});

describe('the boundary checks cannot be sidestepped', () => {
  const planted = (path: string, lines: string[]) => ({ path, imports: importsOf(lines.join('\n'), path) });

  it('read every way of writing an import', () => {
    const source = [
      `import { SampleRequestForm } from '../b2b/SampleRequestForm';`,
      `import AdminApp from "@/features/admin/AdminApp";`,
      `const Shop = lazy(() => import('../../features/shop/ShopPage'));`,
      `export { db } from '../../data/store';`,
      `import './cart.css';`,
      `import { useState } from 'react';`,
      `const hidden = () => import(/* @vite-ignore */ '../admin/AdminApp');`,
      `const all = import.meta.glob('../admin/*.tsx');`,
    ].join('\n');
    expect(importsOf(source, 'features/cart/CartPage.tsx')).toEqual([
      '@/features/b2b/SampleRequestForm',
      '@/features/admin/AdminApp',
      '@/features/shop/ShopPage',
      '@/data/store',
      '@/features/cart/cart.css',
      'react',
      '@/features/admin/AdminApp',
      '@/features/admin/*.tsx',
    ]);
  });

  it('and each rule refuses what it must, and only that', () => {
    const found = boundaryViolations([
      planted('core/cart.ts', [`import { db } from "../data/store";`, `import { roundKg } from './money';`]),
      planted('shared/layout/Footer.tsx', [`const Shop = () => import('../../features/shop/ShopPage');`, `import { Icon } from '../ui/Icon';`]),
      planted('features/cart/CartPage.tsx', [
        `import { SampleRequestForm } from '../b2b/SampleRequestForm';`,
        `import { QuoteForm } from '../b2b';`,
        `import { x } from '@/features/b2b/index';`,
        `const a = () => import(/* @vite-ignore */ '../admin/AdminApp');`,
      ]),
      planted('features/shop/ShopPage.tsx', [`const pages = import.meta.glob('../admin/*.tsx');`]),
      planted('app/App.tsx', [`import { AdminApp } from '../features/admin/AdminApp';`]),
    ]);
    expect(found).toEqual({
      core: ['core/cart.ts → @/data/store'],
      sharedOnFeature: ['shared/layout/Footer.tsx → @/features/shop/ShopPage'],
      featureInternals: [
        'features/cart/CartPage.tsx → @/features/b2b/SampleRequestForm',
        'features/cart/CartPage.tsx → @/features/admin/AdminApp',
        'features/shop/ShopPage.tsx → @/features/admin/*.tsx',
      ],
      adminOnly: ['features/cart/CartPage.tsx → @/features/admin/AdminApp', 'features/shop/ShopPage.tsx → @/features/admin/*.tsx'],
    });
  });
});
