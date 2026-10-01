import { describe, expect, it } from 'vitest';
import { TEXT_MAX } from '@/core/limits';
import type { Client } from '@/data/supabase/client';
import { hashIp } from '../guard';
import { parseCheckoutInput, parseQuoteInput } from '../parse';
import { NUMBER_PLACEHOLDER } from '../prepare';
import { handleStorefront, type Deps } from '../storefront';

/* ───────── A small catalog, as the database returns it ───────── */

const L = (s: string) => ({ ar: s, fr: s, en: s });
const origin = (id: string, species: string, stock_kg: number, price_per_kg: number) => ({
  id, name: L(id), country_code: 'BR', species, region: '', roast_level: 'medium', tasting_notes: L(''),
  stock_kg, low_stock_kg: 1, price_per_kg, custom_blend_enabled: true, restock_date: null, active: true, updated_at: '',
});
const product = (id: string, kind: string, prices: Record<string, number>, recipe: [string, number][]) => ({
  id, slug: id, kind, name: L(id), tagline: L(''), description: L(''), roast_level: 'medium', tasting_notes: L(''),
  prices, image_url: null, featured: false, active: true, sort_order: 1, updated_at: '',
  product_recipes: recipe.map(([origin_id, percent]) => ({ origin_id, percent })),
});
const PAYEE = { bank: { holder: 'BOGA', bankName: 'Banque', rib: '0123' }, cashplus: { beneficiary: 'BOGA' } };
const rowsWith = (settings: Record<string, unknown>, cardEnabled = false): Record<string, unknown[]> => ({
  origins: [origin('brazil', 'arabica', 50, 200), origin('vietnam', 'robusta', 1, 100)],
  products: [
    product('signature', 'signature', { '250': 60, '1000': 200 }, [['brazil', 80], ['vietnam', 20]]),
    product('horeca', 'b2b', { '250': 50, '1000': 150 }, [['brazil', 100]]),
  ],
  shipping_rates: [{ id: 'oujda', city: L('Oujda'), distance_km: 0, base_fee: 20, included_kg: 3, extra_per_kg: 5, delivery_days: '1', active: true }],
  payment_methods: [
    { id: 'card', enabled: cardEnabled, label: L('Carte'), instructions: L('') },
    { id: 'cashplus', enabled: true, label: L('Cash Plus'), instructions: L('') },
    { id: 'bank_transfer', enabled: true, label: L('Virement'), instructions: L('') },
  ],
  site_config: [{ settings: { freeShippingOver: 0, b2bThresholdKg: 10, roastLossPercent: 0, ...settings }, content: {} }],
});

/** Enough of supabase-js for loadCatalog() and rpc(); records every rpc call. */
function fakeDb(opts: { limit?: number; commitError?: string; settings?: Record<string, unknown>; cardEnabled?: boolean } = {}) {
  const tables = rowsWith(opts.settings ?? PAYEE, opts.cardEnabled);
  const hits = new Map<string, number>();
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  // a query is awaited for its rows, or chained further
  interface Query extends Promise<unknown> {
    select(): Query;
    order(): Query;
    eq(): Query;
    maybeSingle(): Promise<unknown>;
  }
  const query = (table: string) => {
    const q: Query = Object.assign(Promise.resolve({ data: tables[table], error: null }), {
      select: () => q,
      order: () => q,
      eq: () => q,
      maybeSingle: async () => ({ data: tables[table][0] ?? null, error: null }),
    });
    return q;
  };
  const rpc = async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    if (name === 'rate_limit_hit') {
      const n = (hits.get(args.p_bucket as string) ?? 0) + 1;
      hits.set(args.p_bucket as string, n);
      return { data: n <= (opts.limit ?? 100), error: null };
    }
    if (opts.commitError) return { data: null, error: { message: opts.commitError } };
    return { data: [{ id: 'row-id', number: 'XX-2026-0001' }], error: null };
  };
  return { db: { from: query, rpc } as unknown as Client, calls };
}

const deps = (db: Client, over: Partial<Deps> = {}): Deps => ({ db, ip: '196.200.1.1', turnstileSecret: '', now: new Date('2026-10-01T10:00:00Z'), ...over });

const contact = { businessType: 'cafe', company: 'Café Test', contactName: 'Amine Test', phone: '0612345678', email: '', cityId: 'oujda', notes: '' };
const customer = { fullName: 'Salma Bennani', phone: '0612345678', email: '', cityId: 'oujda', address: 'Rue 1, Oujda', company: '', notes: '' };
const orderBody = (over: Record<string, unknown> = {}) => ({
  items: [{ id: 'a', type: 'product', productId: 'signature', size: 1000, qty: 2, unitPrice: 1 }],
  customer,
  paymentMethod: 'cashplus',
  locale: 'ar',
  ...over,
});
const committed = (calls: { name: string }[]) => calls.some((c) => c.name.startsWith('commit_'));

describe('storefront: request bodies', () => {
  it('keeps only the known fields of a cart (a price sent by the browser is dropped)', () => {
    expect(parseCheckoutInput(orderBody())?.items).toEqual([{ id: 'a', type: 'product', productId: 'signature', size: 1000, qty: 2 }]);
  });

  it.each([
    ['not an object', null],
    ['an empty cart', orderBody({ items: [] })],
    ['quantity 0', orderBody({ items: [{ id: 'a', type: 'product', productId: 'signature', size: 1000, qty: 0 }] })],
    ['an unknown bag size', orderBody({ items: [{ id: 'a', type: 'product', productId: 'signature', size: 750, qty: 1 }] })],
    ['a customer field that is not text', orderBody({ customer: { ...customer, fullName: 42 } })],
    ['notes longer than the form allows', orderBody({ customer: { ...customer, notes: 'x'.repeat(TEXT_MAX.notes + 1) } })],
    ['a company longer than the form allows', orderBody({ customer: { ...customer, company: 'x'.repeat(TEXT_MAX.company + 1) } })],
    ['an unknown payment method', orderBody({ paymentMethod: 'cod' })],
  ])('refuses an order with %s', (_, raw) => {
    expect(parseCheckoutInput(raw)).toBeNull();
  });

  it('reads a B2B request, refusing an unknown business type', () => {
    expect(parseQuoteInput({ ...contact, items: orderBody().items })?.items).toHaveLength(1);
    expect(parseQuoteInput({ ...contact, businessType: 'bank', items: orderBody().items })).toBeNull();
  });
});

describe('storefront: order', () => {
  it('prices from the database, then commits with the number left to the database', async () => {
    const { db, calls } = fakeDb();
    const r = await handleStorefront('order', orderBody(), deps(db));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, order: { number: 'XX-2026-0001', subtotal: 400, total: 420 } }); // 2 × 200 MAD, not the 1 MAD sent
    const commit = calls.find((c) => c.name === 'commit_order')!;
    expect(commit.args.p_subject).toContain(NUMBER_PLACEHOLDER);
    expect((commit.args.p_order as { stockDeductions: unknown }).stockDeductions).toEqual([
      { originId: 'brazil', kg: 1.6 },
      { originId: 'vietnam', kg: 0.4 },
    ]);
  });

  it('takes no transfer or Cash Plus order before the real payment details exist, and no card order', async () => {
    const closed = fakeDb({ settings: { bank: { holder: '', bankName: '', rib: '' }, cashplus: { beneficiary: '' } } });
    for (const paymentMethod of ['cashplus', 'bank_transfer']) {
      expect((await handleStorefront('order', orderBody({ paymentMethod }), deps(closed.db))).body).toEqual({ ok: false, errors: ['payment_method'] });
    }
    // switched on in the admin, but no gateway on this server yet
    const card = fakeDb({ cardEnabled: true });
    expect((await handleStorefront('order', orderBody({ paymentMethod: 'card' }), deps(card.db))).body).toEqual({ ok: false, errors: ['payment_method'] });
    expect(committed([...closed.calls, ...card.calls])).toBe(false);
  });

  it('counts the phone and the hashed IP, never the IP itself, and only once the order is valid', async () => {
    const { db, calls } = fakeDb();
    await handleStorefront('order', orderBody({ customer: { ...customer, address: 'x' } }), deps(db));
    expect(calls).toEqual([]);
    await handleStorefront('order', orderBody(), deps(db));
    const buckets = calls.filter((c) => c.name === 'rate_limit_hit').map((c) => c.args.p_bucket);
    expect(buckets).toEqual(['order:phone:+212612345678', `order:ip:${await hashIp('196.200.1.1')}`]);
    expect(JSON.stringify(calls)).not.toContain('196.200.1.1');
  });

  it('stops a phone above its limit before anything is saved', async () => {
    const { db, calls } = fakeDb({ limit: 0 });
    expect((await handleStorefront('order', orderBody(), deps(db))).body).toEqual({ ok: false, errors: ['too_many'] });
    expect(committed(calls)).toBe(false);
  });

  it('reports stock bought by someone else between the check and the commit', async () => {
    const { db } = fakeDb({ commitError: 'out_of_stock:brazil' });
    expect((await handleStorefront('order', orderBody(), deps(db))).body).toEqual({ ok: false, errors: ['out_of_stock'] });
  });

  it('answers 400 to what the forms never send, and lets real failures surface', async () => {
    expect((await handleStorefront('order', { items: 'x' }, deps(fakeDb().db))).status).toBe(400);
    expect((await handleStorefront('order', orderBody(), deps(fakeDb({ commitError: 'invalid_order:text_too_long' }).db))).status).toBe(400);
    await expect(handleStorefront('order', orderBody(), deps(fakeDb({ commitError: 'connection lost' }).db))).rejects.toMatchObject({ message: 'connection lost' });
  });

  it('requires a valid Turnstile token once the secret is set', async () => {
    const seen: string[] = [];
    const verifyCaptcha = async (_: string, token: string) => (seen.push(token), token === 'good');
    const { db, calls } = fakeDb();
    const send = (token: string) => handleStorefront('order', orderBody({ captchaToken: token }), deps(db, { turnstileSecret: 'secret', verifyCaptcha }));
    expect((await send('bad')).body).toEqual({ ok: false, errors: ['captcha'] });
    expect(calls).toEqual([]);
    expect(((await send('good')).body as { ok: boolean }).ok).toBe(true);
    expect(seen).toEqual(['bad', 'good']);
  });
});

describe('storefront: B2B request', () => {
  it('prices the cart at the website prices for reference, with the number left to the database', async () => {
    const { db, calls } = fakeDb();
    const items = [{ id: 'a', type: 'product', productId: 'horeca', size: 1000, qty: 12 }];
    const r = await handleStorefront('quote', { ...contact, items }, deps(db));
    expect(r.body).toMatchObject({ ok: true, quote: { number: 'XX-2026-0001', phone: '+212612345678', weightKg: 12, indicativeTotal: 1800, finalPrice: null } });
    expect(calls.map((c) => c.name)).toEqual(['rate_limit_hit', 'rate_limit_hit', 'commit_quote_request']);
    expect(calls[2].args.p_subject).toContain(NUMBER_PLACEHOLDER);
  });

  it('refuses contact errors and a cart with nothing from the catalog, saving nothing', async () => {
    const { db, calls } = fakeDb();
    const items = [{ id: 'a', type: 'product', productId: 'horeca', size: 1000, qty: 12 }];
    expect((await handleStorefront('quote', { ...contact, phone: '123', items }, deps(db))).body).toEqual({ ok: false, errors: ['phone'] });
    const gone = [{ id: 'a', type: 'product', productId: 'gone', size: 1000, qty: 12 }];
    expect((await handleStorefront('quote', { ...contact, items: gone }, deps(db))).status).toBe(400);
    expect(calls).toEqual([]);
  });
});
