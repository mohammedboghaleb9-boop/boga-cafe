/**
 * The catalog shown without prices while the sales are closed (owner 2026-10-21): the site keeps only the display
 * fields of showcase_catalog(), never for sale, and reads it only when told to (VITE_SHOWCASE) and the sales are closed.
 */
import { describe, expect, it } from 'vitest';
import { onDisplay } from '@/core/showcase';
import type { Client } from '../client';
import type { Json } from '../database.types';
import { showcaseFromJson, withShowcase } from '../showcase';
import { createCatalogStore } from '../store';

const loc = (fr: string) => ({ ar: fr, fr, en: fr });
const answer = {
  products: [
    { id: 'boga-signature', slug: 'boga-signature', kind: 'signature', name: loc('BOGA Signature'), tagline: loc('Doux'), description: loc('Le blend'),
      tasting_notes: loc('Chocolat'), roast_level: 'medium', featured: true, sort_order: 1, image_url: null,
      recipe: [{ origin_id: 'honduras', percent: 30 }, { origin_id: 'brazil', percent: 50 }, { origin_id: 'vietnam', percent: 20 }],
      // what the function never returns: read anyway, nothing of it may reach the page
      prices: { 1000: 225 }, active: true, stock_kg: 40 },
  ],
  origins: [
    { id: 'brazil', name: loc('Brésil'), country_code: 'BR', species: 'arabica', region: 'Cerrado Mineiro', roast_level: 'medium',
      tasting_notes: loc('Noisette'), custom_blend_enabled: true, price_per_kg: 220, stock_kg: 40, restock_date: '2026-11-12', active: true },
  ],
};

describe('the display answer', () => {
  it('keeps the display fields, biggest share first, and never a price, a stock, a date or a sale switch', () => {
    const { products, origins } = showcaseFromJson(answer as unknown as Json);
    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({ id: 'boga-signature', kind: 'signature', featured: true, sortOrder: 1, prices: {}, active: false, listed: true });
    expect(products[0].recipe).toEqual([{ originId: 'brazil', percent: 50 }, { originId: 'honduras', percent: 30 }, { originId: 'vietnam', percent: 20 }]);
    expect(products[0].image).toBeUndefined();
    expect(origins[0]).toMatchObject({ id: 'brazil', region: 'Cerrado Mineiro', customBlendEnabled: true, pricePerKg: null, stockKg: 0, active: false, listed: true });
    expect(origins[0].restockDate).toBeUndefined();
    expect(JSON.stringify(showcaseFromJson(answer as unknown as Json))).not.toMatch(/225|220|2026-11-12/);
  });

  it('an answer of another shape gives nothing, not an error', () => {
    for (const j of [null, [], 'x', { products: 'x' }] as Json[]) expect(showcaseFromJson(j)).toEqual({ products: [], origins: [] });
  });

  it('a row for sale keeps its own data; the listed ones are added, in the catalog order', () => {
    const shown = showcaseFromJson(answer as unknown as Json);
    const forSale = { ...shown.products[0], prices: { 1000: 225 }, active: true, listed: undefined, sortOrder: 1 };
    const other = { ...shown.products[0], id: 'first', sortOrder: 0 };
    const merged = withShowcase({ products: [forSale], origins: [] }, { products: [...shown.products, other], origins: shown.origins });
    expect(merged.products.map((p) => [p.id, p.active])).toEqual([['first', false], ['boga-signature', true]]);
    expect(merged.products[1].prices).toEqual({ 1000: 225 });
    expect(withShowcase({ products: [forSale], origins: [] }, null).products).toEqual([forSale]);
  });

  it('on the site: an item for sale or listed; nothing else', () => {
    expect([onDisplay({ active: true }), onDisplay({ active: false, listed: true }), onDisplay({ active: false }), onDisplay({ active: false, listed: false })])
      .toEqual([true, true, false, false]);
  });
});

/** The tables a visitor reads today (nothing for sale) and the display function, counted. */
function fakeClient(settings: object, rpc: () => Promise<{ data: unknown; error: Error | null }>) {
  const calls: string[] = [];
  const from = (table: string) => {
    const rows = table === 'site_config' ? [{ settings, content: {} }] : [];
    const q = Object.assign(Promise.resolve({ data: rows, error: null }), {
      select: () => q,
      order: () => q,
      eq: () => q,
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
    });
    return q;
  };
  return { calls, client: { from, rpc: (name: string) => (calls.push(name), rpc()) } as unknown as Client };
}
const answers = async () => ({ data: answer as unknown, error: null });

describe('the shop reads the display', () => {
  it('flag on and sales closed: the listed catalog, without prices', async () => {
    const { calls, client } = fakeClient({}, answers);
    const store = createCatalogStore(client, { showcase: true });
    await store.load();
    expect(calls).toEqual(['showcase_catalog']);
    expect(store.status.get()).toBe('ready');
    expect(store.db.get().products.map((p) => [p.id, p.active, p.listed, p.prices])).toEqual([['boga-signature', false, true, {}]]);
    expect(store.db.get().origins.map((o) => o.id)).toEqual(['brazil']);
  });

  it('flag off (the database has no function yet): never asked', async () => {
    const { calls, client } = fakeClient({}, answers);
    const store = createCatalogStore(client, { showcase: false });
    await store.load();
    expect(calls).toEqual([]);
    expect(store.db.get().products).toEqual([]);
  });

  it('sales open: not asked, the shop shows what is for sale', async () => {
    const { calls, client } = fakeClient({ salesOpen: true }, answers);
    const store = createCatalogStore(client, { showcase: true });
    await store.load();
    expect(calls).toEqual([]);
  });

  it('the display read fails: the site stays up with its empty lists', async () => {
    const { client } = fakeClient({}, async () => ({ data: null, error: new Error('function showcase_catalog does not exist') }));
    const store = createCatalogStore(client, { showcase: true });
    const errors: unknown[] = [];
    const log = console.error;
    console.error = (...a: unknown[]) => void errors.push(a);
    try {
      await store.load();
    } finally {
      console.error = log;
    }
    expect(store.status.get()).toBe('ready');
    expect(store.db.get().products).toEqual([]);
    expect(errors).toHaveLength(1);
  });
});
