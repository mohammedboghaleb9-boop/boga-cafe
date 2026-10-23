import { describe, expect, it } from 'vitest';
import { MAX_FILE_RULES, shopHeadersFile } from '../scripts/shop-headers.mjs';

const LONG = 'Cache-Control: public, max-age=31536000, immutable';
const rules = (text: string) => [...text.matchAll(/^(\/\S+)\n((?: {2}.+\n?)+)/gm)].map((m) => ({ path: m[1], lines: m[2].trim().split('\n').map((l) => l.trim()) }));

describe('the shop headers: a year of cache for the hashed files that exist, nothing else', () => {
  const files = ['index.html', '_headers', 'assets/packshot-C7fJ_hY-.webp', 'assets/index-CAIYn68v.js', 'assets/hero-1080-aB3dEf9h.mp4', 'assets/AdminApp-DAAADAAA.css'];
  const text = shopHeadersFile(files);

  it('gives each hashed file its own exact rule', () => {
    const long = rules(text).filter((r) => r.lines.includes(LONG));
    expect(long.map((r) => r.path).sort()).toEqual(['/assets/AdminApp-DAAADAAA.css', '/assets/hero-1080-aB3dEf9h.mp4', '/assets/index-CAIYn68v.js', '/assets/packshot-C7fJ_hY-.webp']);
  });

  it('never uses a splat: an unknown /assets path is answered with the site\'s HTML, which must not be kept for a year', () => {
    expect(text).not.toMatch(/\/assets\/\*/);
    expect(text).not.toMatch(/\*.*\n {2}Cache-Control/);
    // the page rule carries no cache rule: the HTML always asks again
    expect(rules(text).find((r) => r.path === '/*')!.lines.some((l) => l.startsWith('Cache-Control'))).toBe(false);
  });

  it('gives nothing to the pages, to a file whose name has no hash, or to _headers itself', () => {
    const t = shopHeadersFile(['index.html', '_headers', 'assets/logo.svg', 'favicon.svg', 'assets/packshot-C7fJ_hY-.webp']);
    expect(rules(t).map((r) => r.path)).toEqual(['/*', '/assets/packshot-C7fJ_hY-.webp']);
  });

  it('reads real Vite names: dashes and underscores in or at the end of the hash, dots, capitals; and skips what is not safe to name', () => {
    const real = ['assets/packshot-C7fJ_hY-.webp', 'assets/barista-zl8lBP_-.webp', 'assets/cinzel-latin-500-normal-B-2dbOfA.woff2', 'assets/AdminApp-BX26Guu_.css', 'assets/foo.bar-aB3dEf9h.js'];
    expect(rules(shopHeadersFile(real)).slice(1).map((r) => r.path).sort()).toEqual(real.map((f) => `/${f}`).sort());
    // a character Cloudflare would read as a placeholder or splat never reaches a rule
    const odd = ['assets/a$b-aB3dEf9h.js', 'assets/x:y-aB3dEf9h.js', 'assets/star*-aB3dEf9h.js', 'assets/photo-aB3dEf9h.JPG'];
    expect(rules(shopHeadersFile(odd)).map((r) => r.path)).toEqual(['/*']);
  });

  it('keeps the security rules on every page', () => {
    const page = rules(text).find((r) => r.path === '/*')!.lines;
    expect(page).toEqual(expect.arrayContaining(['X-Frame-Options: DENY', "Content-Security-Policy: frame-ancestors 'none'", 'X-Content-Type-Options: nosniff', 'X-Robots-Tag: noindex']));
  });

  it('stays under Cloudflare\'s 100 rules, media first', () => {
    const many = [...Array.from({ length: 120 }, (_, i) => `assets/a${String(i).padStart(3, '0')}-abcd1234.js`), 'assets/zz-abcd1234.webp'];
    const r = rules(shopHeadersFile(many));
    expect(r).toHaveLength(1 + MAX_FILE_RULES);
    expect(r[1].path).toBe('/assets/zz-abcd1234.webp');
    expect(r.length).toBeLessThan(100);
  });
});
