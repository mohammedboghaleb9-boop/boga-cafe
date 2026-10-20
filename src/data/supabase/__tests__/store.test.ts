/**
 * The live catalog in the site (VITE_DATA_MODE=supabase): rows become the
 * DbState pages read, and a failed read shows an error, never the seed's
 * example catalog.
 */
import { describe, expect, it } from 'vitest';
import { seedProducts } from '@/data/seed/catalog';
import { LIVE_DEFAULT_SETTINGS } from '@/data/defaults';
import type { Client } from '../client';
import type { Json } from '../database.types';
import { originFromRow, settingsFromRows, shippingRateFromRow } from '../rows';
import { createCatalogStore } from '../store';

const loc = (fr: string) => ({ ar: fr, fr, en: fr });
const tables: Record<string, unknown[]> = {
  origins: [
    { id: 'brazil', name: loc('Brésil'), country_code: 'BR', species: 'arabica', region: 'Minas', roast_level: 'medium', tasting_notes: loc('Cacao'),
      stock_kg: '12.5', low_stock_kg: 5, price_per_kg: 220, custom_blend_enabled: true, restock_date: null, active: true, updated_at: '' },
  ],
  products: [
    { id: 'live-blend', slug: 'live-blend', kind: 'signature', name: loc('Live Blend'), tagline: loc(''), description: loc(''), roast_level: 'medium',
      tasting_notes: loc(''), prices: { 250: 60, 500: 110 }, image_url: null, featured: true, active: true, sort_order: 1, updated_at: '',
      product_recipes: [{ origin_id: 'brazil', percent: 100 }] },
  ],
  shipping_rates: [{ id: 'oujda', city: loc('Oujda'), distance_km: 0, base_fee: 20, included_kg: 3, extra_per_kg: 5, delivery_days: '1', active: true }],
  payment_methods: [{ id: 'cashplus', enabled: true, label: loc('Cash Plus'), instructions: loc('') }],
  site_config: [{ settings: { b2bThresholdKg: 25 }, content: {} }],
};

/** Enough of supabase-js for loadCatalog(); `failing` tables answer with an error; `reads` counts queries per table. */
function fakeClient(failing = new Set<string>(), reads = new Map<string, number>()) {
  const from = (table: string) => {
    reads.set(table, (reads.get(table) ?? 0) + 1);
    const result = failing.has(table) ? { data: null, error: new Error(`${table} unreachable`) } : { data: tables[table], error: null };
    const q = Object.assign(Promise.resolve(result), {
      select: () => q,
      order: () => q,
      eq: () => q,
      maybeSingle: async () => (failing.has(table) ? result : { data: tables[table][0] ?? null, error: null }),
    });
    return q;
  };
  return { from } as unknown as Client;
}

describe('live catalog store', () => {
  it('turns the rows a visitor may read into the state the pages use', async () => {
    const store = createCatalogStore(fakeClient());
    expect(store.status.get()).toBe('loading');
    expect(store.db.get().products).toEqual([]); // nothing to show yet, not the examples
    await store.load();
    const s = store.db.get();
    expect(store.status.get()).toBe('ready');
    expect(s.products.map((p) => p.id)).toEqual(['live-blend']);
    expect(s.products[0].recipe).toEqual([{ originId: 'brazil', percent: 100 }]);
    expect(s.origins[0].stockKg).toBe(12.5); // numeric columns can arrive as text
    expect(s.paymentMethods.map((m) => m.id)).toEqual(['cashplus']);
    // a stored setting wins over the code default; others keep the default
    expect(s.settings.b2bThresholdKg).toBe(25);
    expect(s.settings.customBlend).toEqual(LIVE_DEFAULT_SETTINGS.customBlend); // off, no fee: never the examples
    expect(s.settings.salesOpen).toBe(false); // not stored: closed
  });

  it('slice 12: the sales open only on an explicit true; no price and no cap stay none', () => {
    const open = (stored: Record<string, unknown>, defaults = LIVE_DEFAULT_SETTINGS) => settingsFromRows(stored as Json, null, defaults).salesOpen;
    expect(open({ salesOpen: true })).toBe(true);
    for (const v of [false, 'true', 1, null, undefined]) expect(open({ salesOpen: v })).toBe(false);
    expect(open({}, { ...LIVE_DEFAULT_SETTINGS, salesOpen: true })).toBe(false); // a default never opens them
    const [row] = tables.origins as Parameters<typeof originFromRow>[0][];
    expect(originFromRow({ ...row, price_per_kg: null }).pricePerKg).toBeNull(); // never 0
    const [city] = tables.shipping_rates as Parameters<typeof shippingRateFromRow>[0][];
    expect(shippingRateFromRow({ ...city, max_fee: '30.00' as unknown as number }).maxFee).toBe(30);
    expect(shippingRateFromRow({ ...city, max_fee: null })).not.toHaveProperty('maxFee');
    expect(shippingRateFromRow(city)).not.toHaveProperty('maxFee'); // a database before the migration: no column, no cap
  });

  it('shows an error, never the example catalog, and recovers on retry', async () => {
    const failing = new Set(['products']);
    const store = createCatalogStore(fakeClient(failing));
    let heard = 0;
    store.status.subscribe(() => heard++);
    await store.load();
    expect(store.status.get()).toBe('error');
    expect(store.db.get().products).toEqual([]);
    expect(store.db.get().products).not.toEqual(seedProducts);
    expect(heard).toBeGreaterThanOrEqual(2); // loading, then error: the layout re-renders

    failing.clear();
    await store.load();
    expect(store.status.get()).toBe('ready');
    expect(store.db.get().products).toHaveLength(1);
  });

  it('reads once for two clicks, and says "loading" as soon as a retry starts', async () => {
    const failing = new Set(['products']);
    const reads = new Map<string, number>();
    const store = createCatalogStore(fakeClient(failing, reads));
    await store.load();
    expect(store.status.get()).toBe('error');
    failing.clear();
    const first = store.load();
    expect(store.status.get()).toBe('loading'); // the error screen does not stay up while it retries
    const second = store.load(); // a second click while it loads
    await Promise.all([first, second]);
    expect(reads.get('products')).toBe(2); // the failed read, then one retry
    expect(store.status.get()).toBe('ready');
  });
});
