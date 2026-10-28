import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SITE_ORIGIN, canonicalFor } from '../src/shared/layout/canonical';

const pub = (name: string) => readFileSync(new URL(`../public/${name}`, import.meta.url), 'utf8');

describe('robots.txt: valid, and open while the site is noindex', () => {
  const lines = pub('robots.txt').split('\n').filter((l) => l.trim() && !l.startsWith('#'));

  it('allows every crawler in, so it can read the noindex (a Disallow would hide it)', () => {
    expect(lines).toEqual(['User-agent: *', 'Allow: /']);
  });
});

describe('sitemap.xml: only the pages a search engine may list', () => {
  const xml = pub('sitemap.xml');
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

  it('is a urlset in the sitemap namespace with one entry per page', () => {
    expect(xml).toMatch(/<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
    expect(locs.length).toBeGreaterThan(0);
    expect(new Set(locs).size).toBe(locs.length);
  });

  it('lists exactly the addresses the pages name as their canonical (cart, checkout, orders, admin never)', () => {
    for (const loc of locs) {
      expect(loc.startsWith(SITE_ORIGIN), loc).toBe(true);
      expect(canonicalFor(new URL(loc).pathname), loc).toBe(loc);
    }
  });
});
