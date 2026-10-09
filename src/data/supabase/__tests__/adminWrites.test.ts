/**
 * The Admin Panel's writes on the live site (slices 8-9): each goes to its database
 * function with the admin's session, the panel reads its data again afterwards,
 * and a refusal or no answer is never taken for a success.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Origin, Product, QuoteRequest } from '@/core/types';
import { STATE_VERSION, type DbState } from '../../state';
import type { AdminData } from '../../types';
import { createAdminWrites, WriteFailed } from '../adminWrites';
import type { Client } from '../client';

const quote = { id: 'q1', status: 'new', finalPrice: null, adminNotes: 'old note', updatedAt: '2026-10-08T10:00:00.123456+00:00' } as unknown as QuoteRequest;
const loc = (fr: string) => ({ ar: '', fr, en: '' });
const product: Product = {
  id: 'test-produit',
  slug: 'test-produit',
  kind: 'signature',
  name: loc('TEST produit'),
  tagline: loc(''),
  description: loc(''),
  recipe: [{ originId: 'test-origine', percent: 100 }],
  roastLevel: 'medium',
  tastingNotes: loc(''),
  prices: { 250: 1 },
  image: 'https://example.invalid/photo.webp',
  featured: false,
  active: false,
  sortOrder: 9,
  updatedAt: '2026-10-09T10:00:00.123456+00:00',
};
const origin = {
  id: 'test-origine',
  name: loc('TEST origine'),
  countryCode: 'ET',
  species: 'arabica',
  region: '',
  roastLevel: 'light',
  tastingNotes: loc(''),
  stockKg: 0,
  lowStockKg: 3,
  pricePerKg: 100,
  customBlendEnabled: true,
  active: false,
  updatedAt: '2026-10-09T11:00:00.123456+00:00',
} satisfies Origin;

function setup(answer: { error: { message: string; code?: string } | null } = { error: null }, refresh: () => Promise<void> = async () => {}) {
  const rpc = vi.fn(async () => ({ data: null, ...answer }));
  const data: AdminData = {
    db: { get: () => ({ version: STATE_VERSION, quotes: [quote], products: [product], origins: [origin] }) as unknown as DbState, subscribe: () => () => {} },
    status: { get: () => 'ready', subscribe: () => () => {} },
    reload: vi.fn(),
    refresh: vi.fn(refresh),
  };
  const writes = createAdminWrites(() => ({ rpc }) as unknown as Client, data);
  return { writes, rpc, data };
}

beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

describe('admin writes (live site)', () => {
  it('sends each change to its database function, then reads the panel data again', async () => {
    const { writes, rpc, data } = setup();
    expect(await writes.setOrderStatus('o1', 'confirmed', 'staff')).toBeNull();
    expect(await writes.setPaymentStatus('o1', 'paid', 'owner')).toBe(true);
    await writes.adjustStock('brazil', -1.5, 'correction', '  TEST  ');
    await writes.updateQuote('q1', { status: 'negotiating', finalPrice: 5500 });
    expect(rpc.mock.calls).toEqual([
      ['set_order_status', { p_order_id: 'o1', p_status: 'confirmed' }],
      ['set_payment_status', { p_order_id: 'o1', p_status: 'paid' }],
      ['adjust_stock', { p_origin_id: 'brazil', p_delta_kg: -1.5, p_reason: 'correction', p_note: 'TEST' }],
      // the follow-up is sent whole, with the version the page read (a newer one in the database = 'stale')
      ['update_quote_request', { p_id: 'q1', p_status: 'negotiating', p_final_price: 5500, p_admin_notes: 'old note', p_seen_at: quote.updatedAt }],
    ]);
    expect(data.refresh).toHaveBeenCalledTimes(4);
  });

  it('a refusal comes back as a refusal (the panel reads again); no answer is an error, never a success', async () => {
    const refused = setup({ error: { message: 'needs_payment', code: 'P0001' } });
    expect(await refused.writes.setOrderStatus('o1', 'in_production', 'owner')).toBe('needs_payment');
    expect(refused.data.refresh).toHaveBeenCalledTimes(1);

    const forbidden = setup({ error: { message: 'forbidden', code: 'P0001' } });
    expect(await forbidden.writes.setPaymentStatus('o1', 'paid', 'owner')).toBe(false);
    await expect(forbidden.writes.adjustStock('brazil', 1, 'restock', '')).rejects.toThrow(WriteFailed);

    const offline = setup({ error: { message: 'TypeError: Failed to fetch' } });
    await expect(offline.writes.setOrderStatus('o1', 'confirmed', 'owner')).rejects.toThrow(WriteFailed);
    await expect(offline.writes.setPaymentStatus('o1', 'paid', 'owner')).rejects.toThrow(WriteFailed);
    await expect(offline.writes.updateQuote('q1', { adminNotes: 'x' })).rejects.toThrow(WriteFailed);
    // it may have been saved all the same: the panel reads again before a second try
    expect(offline.data.refresh).toHaveBeenCalledTimes(3);
  });

  it('a write ends only once the panel has read the saved data again', async () => {
    let done!: () => void;
    const { writes } = setup({ error: null }, () => new Promise<void>((r) => (done = r)));
    let finished = false;
    const write = writes.adjustStock('brazil', 1, 'restock', '').then(() => (finished = true));
    await new Promise((r) => setTimeout(r, 5));
    expect(finished).toBe(false); // no "saved" before the page shows it
    done();
    await write;
    expect(finished).toBe(true);
  });

  it('a new product is sent hidden, with an id from its name that is free, its prices only, never its photo', async () => {
    const { writes, rpc } = setup();
    const draft = { ...product, id: '', slug: '', active: true, prices: { 250: 1, 500: 0, 1000: undefined }, updatedAt: undefined };
    const created = await writes.createProduct(draft);
    // "test-produit" is taken: the new one never replaces it
    expect(created).toMatchObject({ id: 'test-produit-2', slug: 'test-produit-2', active: false });
    expect(rpc).toHaveBeenCalledWith('save_product', {
      p_product: {
        id: 'test-produit-2',
        slug: 'test-produit-2',
        kind: 'signature',
        name: product.name,
        tagline: product.tagline,
        description: product.description,
        roastLevel: 'medium',
        tastingNotes: product.tastingNotes,
        prices: { '250': 1 },
        featured: false,
        active: false,
        sortOrder: 9,
      },
      p_recipe: [{ originId: 'test-origine', percent: 100 }],
      p_seen_at: null,
    });
  });

  it('an edit carries the version the form read; an origin edit too, and a new origin is sent hidden', async () => {
    const { writes, rpc } = setup();
    expect(await writes.saveProduct({ ...product, prices: { 250: 2 } })).toBe(true);
    expect(rpc).toHaveBeenLastCalledWith('save_product', expect.objectContaining({ p_seen_at: product.updatedAt }));
    expect(await writes.saveOrigin({ ...origin, pricePerKg: 120 })).toBe(true);
    expect(rpc).toHaveBeenLastCalledWith('save_origin', {
      p_origin: { id: 'test-origine', name: origin.name, countryCode: 'ET', species: 'arabica', region: '', roastLevel: 'light', tastingNotes: origin.tastingNotes, lowStockKg: 3, pricePerKg: 120, customBlendEnabled: true },
      p_seen_at: origin.updatedAt,
    });
    expect(await writes.createOrigin({ ...origin, id: '', stockKg: 50, active: true, updatedAt: undefined })).toMatchObject({ id: 'test-origine-2', stockKg: 0, active: false });
    expect(rpc).toHaveBeenLastCalledWith('save_origin', expect.objectContaining({ p_seen_at: null }));
  });

  it('a refused catalog save (an older copy: stale) is "not saved"; no answer is an error; nothing is sent without a version', async () => {
    const stale = setup({ error: { message: 'stale', code: 'P0001' } });
    expect(await stale.writes.saveProduct(product)).toBe(false);
    expect(await stale.writes.saveOrigin(origin)).toBe(false);
    expect(await stale.writes.createOrigin({ ...origin, updatedAt: undefined })).toBeNull();
    await expect(stale.writes.createProduct(product)).rejects.toThrow(WriteFailed);
    expect(stale.data.refresh).toHaveBeenCalledTimes(4);

    const offline = setup({ error: { message: 'TypeError: Failed to fetch' } });
    await expect(offline.writes.saveProduct(product)).rejects.toThrow(WriteFailed);
    await expect(offline.writes.saveOrigin(origin)).rejects.toThrow(WriteFailed);

    const unread = setup();
    expect(await unread.writes.saveProduct({ ...product, updatedAt: undefined })).toBe(false);
    expect(await unread.writes.saveOrigin({ ...origin, pricePerKg: 0 })).toBe(false);
    expect(unread.rpc).not.toHaveBeenCalled();
  });
});
