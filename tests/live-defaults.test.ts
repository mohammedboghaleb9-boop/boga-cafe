import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EMPTY_CONTENT, LIVE_DEFAULT_SETTINGS } from '../src/data/defaults';
import { settingsFromRows } from '../src/data/supabase/rows';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

/** The default a database function uses for a missing settings key: coalesce((s ... 'key' ...)::numeric, N). */
const sqlDefault = (sql: string, key: string) => {
  const m = new RegExp(`coalesce\\(\\(s (?:->>|#>>) '\\{?${key}\\}?'\\)::(?:numeric|boolean), ([\\w.]+)\\)`).exec(sql);
  expect(m, key).not.toBeNull();
  return m![1];
};

describe('live defaults for a setting the database row does not hold', () => {
  const ready = read('supabase/migrations/20261016120000_catalog_ready.sql');
  const expiry = read('supabase/migrations/20261019200936_expiry_lock_order.sql');

  it('are the database functions\' own, so the site and the database price an order the same way', () => {
    const d = LIVE_DEFAULT_SETTINGS;
    expect(String(d.b2bThresholdKg)).toBe(sqlDefault(ready, 'b2bThresholdKg'));
    expect(String(d.freeShippingOver)).toBe(sqlDefault(ready, 'freeShippingOver'));
    expect(String(d.roastLossPercent)).toBe(sqlDefault(ready, 'roastLossPercent'));
    expect(String(d.customBlend.minPercent)).toBe(sqlDefault(ready, 'customBlend,minPercent'));
    expect(String(d.customBlend.maxOrigins)).toBe(sqlDefault(ready, 'customBlend,maxOrigins'));
    expect(String(d.customBlend.enabled)).toBe(sqlDefault(ready, 'customBlend,enabled'));
    // a missing fee for a size counts 0 in check_order
    expect(ready).toMatch(/coalesce\(\(s #>> array\['customBlend', 'feeBySize', v_size::integer::text\]\)::numeric, 0\)/);
    expect(Object.values(d.customBlend.feeBySize)).toEqual([0, 0, 0]);
    // the expiry cron: 48 h unpaid, 120 h for a reported payment
    expect(expiry).toContain("::numeric else 48 end");
    expect(expiry).toContain("::numeric else 120 end");
    expect([d.unpaidOrderTimeoutHours, d.paymentCheckTimeoutHours]).toEqual([48, 120]);
  });

  it('open nothing and invent nothing: sales closed, no payee, no recipient', () => {
    const s = settingsFromRows({}, null, LIVE_DEFAULT_SETTINGS);
    expect(s.salesOpen).toBe(false);
    expect(s.customBlend.enabled).toBe(false);
    expect(Object.values(s.bank).join('') + Object.values(s.cashplus).join('')).toBe('');
    expect(s.notifications.adminEmail + s.notifications.adminWhatsapp).toBe('');
  });

  it('the live site, its Admin Panel and the storefront server never read the examples (src/data/seed)', () => {
    const files = (dir: string): string[] =>
      readdirSync(new URL(`../${dir}`, import.meta.url), { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? (e.name === '__tests__' ? [] : files(`${dir}/${e.name}`)) : /\.tsx?$/.test(e.name) ? [`${dir}/${e.name}`] : [],
      );
    const live = [...files('src/data/supabase'), ...files('src/server'), 'src/data/defaults.ts'];
    expect(live.length).toBeGreaterThan(10);
    // any module path naming seed (import or dynamic import), not a comment mentioning it
    for (const file of live) expect(read(file), file).not.toMatch(/['"`][^'"`\n]*\bseed\b[^'"`\n]*['"`]/);
  });

  it('a text the live row does not hold stays empty', () => {
    expect(Object.values(EMPTY_CONTENT).every((l) => l.ar + l.fr + l.en === '')).toBe(true);
  });
});
