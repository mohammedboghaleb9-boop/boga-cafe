import { describe, expect, it } from 'vitest';
import { TEXT_MAX } from '@/core/limits';
import type { Client } from '@/data/supabase/client';
import { hashIp, ipBucket, verifyTurnstile } from '../guard';
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
  shipping_rates: [
    { id: 'oujda', city: L('Oujda'), distance_km: 0, base_fee: 20, included_kg: 3, extra_per_kg: 5, delivery_days: '1', active: true },
    { id: 'closed', city: L('Fermée'), distance_km: 9, base_fee: 30, included_kg: 3, extra_per_kg: 5, delivery_days: '2', active: false },
  ],
  payment_methods: [
    { id: 'card', enabled: cardEnabled, label: L('Carte'), instructions: L('') },
    { id: 'cashplus', enabled: true, label: L('Cash Plus'), instructions: L('') },
    { id: 'bank_transfer', enabled: true, label: L('Virement'), instructions: L('') },
  ],
  site_config: [{ settings: { freeShippingOver: 0, b2bThresholdKg: 10, roastLossPercent: 0, ...settings }, content: {} }],
});

interface FakeOptions {
  /** max hits of every bucket whose name starts with limitPrefix (default: all) */
  limit?: number;
  limitPrefix?: string;
  commitError?: string;
  settings?: Record<string, unknown>;
  cardEnabled?: boolean;
  /** unpaid orders this phone already holds */
  openOrders?: number;
}

/** Enough of supabase-js for loadCatalog(), the open-orders count and rpc(); records every call. */
function fakeDb(opts: FakeOptions = {}) {
  const tables = rowsWith(opts.settings ?? PAYEE, opts.cardEnabled);
  const hits = new Map<string, number>();
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const reads: string[] = [];
  // a query is awaited for its rows (or, for orders, its count), or chained further
  interface Query extends Promise<unknown> {
    select(): Query;
    order(): Query;
    eq(): Query;
    in(): Query;
    maybeSingle(): Promise<unknown>;
  }
  const query = (table: string) => {
    reads.push(table);
    const result = table === 'orders' ? { data: null, count: opts.openOrders ?? 0, error: null } : { data: tables[table], error: null };
    const q: Query = Object.assign(Promise.resolve(result), {
      select: () => q,
      order: () => q,
      eq: () => q,
      in: () => q,
      maybeSingle: async () => ({ data: tables[table][0] ?? null, error: null }),
    });
    return q;
  };
  const rpc = async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    if (name === 'rate_limit_hit') {
      const bucket = args.p_bucket as string;
      const n = (hits.get(bucket) ?? 0) + 1;
      hits.set(bucket, n);
      const limited = bucket.startsWith(opts.limitPrefix ?? '');
      return { data: n <= (limited ? (opts.limit ?? 100) : 100), error: null };
    }
    if (opts.commitError) return { data: null, error: { message: opts.commitError } };
    return { data: [{ id: 'row-id', number: 'XX-2026-0001' }], error: null };
  };
  return { db: { from: query, rpc } as unknown as Client, calls, reads };
}

const IP_KEY = 'server-secret';
const deps = (db: Client, over: Partial<Deps> = {}): Deps => ({
  db, ip: '196.200.1.1', ipKey: IP_KEY, turnstileSecret: '', now: new Date('2026-10-01T10:00:00Z'), ...over,
});

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
/** Limit buckets of accepted requests (the per-connection budget is spent on every request). */
const counted = (calls: { name: string; args: Record<string, unknown> }[]) =>
  calls.filter((c) => c.name === 'rate_limit_hit' && !String(c.args.p_bucket).startsWith('req:')).map((c) => c.args.p_bucket);
const b2bItems = [{ id: 'a', type: 'product', productId: 'horeca', size: 1000, qty: 12 }];

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
    ['a NUL character (PostgreSQL cannot store it)', orderBody({ customer: { ...customer, notes: 'a\u0000b' } })],
    ['a lone high surrogate (not valid in jsonb)', orderBody({ customer: { ...customer, fullName: 'Salma \uD800' } })],
    ['a lone low surrogate (not valid in jsonb)', orderBody({ customer: { ...customer, fullName: 'Salma \uDC00x' } })],
    ['an unknown payment method', orderBody({ paymentMethod: 'cod' })],
  ])('refuses an order with %s', (_, raw) => {
    expect(parseCheckoutInput(raw)).toBeNull();
  });

  it('keeps an emoji (a valid surrogate pair) and counts it as one character', () => {
    expect(parseCheckoutInput(orderBody({ customer: { ...customer, notes: '☕'.repeat(TEXT_MAX.notes) } }))).not.toBeNull();
    expect(parseCheckoutInput(orderBody({ customer: { ...customer, notes: '\u{1F600}'.repeat(TEXT_MAX.notes) } }))).not.toBeNull();
  });

  it('reads a B2B request within the form limits, refusing an unknown business type', () => {
    expect(parseQuoteInput({ ...contact, items: b2bItems })?.items).toHaveLength(1);
    expect(parseQuoteInput({ ...contact, businessType: 'bank', items: b2bItems })).toBeNull();
    expect(parseQuoteInput({ ...contact, contactName: 'x'.repeat(TEXT_MAX.name + 1), items: b2bItems })).toBeNull();
    expect(parseQuoteInput({ ...contact, notes: 'x'.repeat(TEXT_MAX.notes + 1), items: b2bItems })).toBeNull();
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

  it('counts the phone and a keyed hash of the IP, never the IP itself, and only once the order is valid', async () => {
    const { db, calls } = fakeDb();
    await handleStorefront('order', orderBody({ customer: { ...customer, address: 'x' } }), deps(db));
    expect(counted(calls)).toEqual([]);
    await handleStorefront('order', orderBody(), deps(db));
    const h = await hashIp('196.200.1.1', IP_KEY);
    expect(counted(calls)).toEqual(['order:phone:3600:+212612345678', `order:ip:3600:${h}`, `order:ip:86400:${h}`]);
    expect(JSON.stringify(calls)).not.toContain('196.200.1.1');
    // without the server's key the hash cannot be recomputed from a guessed IP
    expect(await hashIp('196.200.1.1', 'another-key')).not.toBe(h);
  });

  it('counts an IPv6 visitor by its /64 network, which one host can rotate through', async () => {
    expect(ipBucket('2a02:4780:1:2:aaaa::1')).toBe('2a02:4780:1:2::/64');
    expect(ipBucket('2a02:4780:0001:0002:ffff:1:2:3')).toBe('2a02:4780:1:2::/64');
    expect(ipBucket('2a02:4780::5')).toBe('2a02:4780:0:0::/64');
    expect(ipBucket('196.200.1.1')).toBe('196.200.1.1');
    expect(await hashIp('2a02:4780:1:2:aaaa::1', IP_KEY)).toBe(await hashIp('2a02:4780:1:2:bbbb:cccc:dddd:eeee', IP_KEY));
    expect(await hashIp('2a02:4780:1:2::1', IP_KEY)).not.toBe(await hashIp('2a02:4780:1:3::1', IP_KEY));
  });

  it('stops a phone above its limit before anything is saved', async () => {
    const { db, calls } = fakeDb({ limit: 0, limitPrefix: 'order:phone:' });
    expect((await handleStorefront('order', orderBody(), deps(db))).body).toEqual({ ok: false, errors: ['too_many'] });
    expect(committed(calls)).toBe(false);
  });

  it('does not lock a phone out for its unpaid orders (phones are not verified: anyone could block a customer)', async () => {
    const { db } = fakeDb({ openOrders: 5 });
    expect(((await handleStorefront('order', orderBody(), deps(db))).body as { ok: boolean }).ok).toBe(true);
  });

  it('stops a connection that sends too many requests before reading the catalog', async () => {
    const { db, calls, reads } = fakeDb({ limit: 0, limitPrefix: 'req:ip:' });
    expect((await handleStorefront('order', orderBody(), deps(db))).body).toEqual({ ok: false, errors: ['too_many'] });
    expect(reads).toEqual([]);
    expect(committed(calls)).toBe(false);
  });

  it('reports stock bought by someone else between the check and the commit', async () => {
    const { db } = fakeDb({ commitError: 'out_of_stock:brazil' });
    expect((await handleStorefront('order', orderBody(), deps(db))).body).toEqual({ ok: false, errors: ['out_of_stock'] });
  });

  it('answers 400 to what the forms never send, and lets real failures surface', async () => {
    expect((await handleStorefront('order', { items: 'x' }, deps(fakeDb().db))).status).toBe(400);
    expect((await handleStorefront('order', orderBody(), deps(fakeDb({ commitError: 'invalid_order:text_too_long' }).db))).status).toBe(400);
    expect((await handleStorefront('order', orderBody(), deps(fakeDb({ commitError: 'invalid_order' }).db))).status).toBe(400);
    await expect(handleStorefront('order', orderBody(), deps(fakeDb({ commitError: 'connection lost' }).db))).rejects.toMatchObject({ message: 'connection lost' });
  });

  it('requires a valid Turnstile token once the secret is set', async () => {
    const seen: string[] = [];
    const verifyCaptcha = async (_: string, token: string) => (seen.push(token), token === 'good');
    const { db, calls } = fakeDb();
    const send = (token: string) => handleStorefront('order', orderBody({ captchaToken: token }), deps(db, { turnstileSecret: 'secret', verifyCaptcha }));
    expect((await send('bad')).body).toEqual({ ok: false, errors: ['captcha'] });
    expect(committed(calls) || counted(calls).length > 0).toBe(false);
    expect(((await send('good')).body as { ok: boolean }).ok).toBe(true);
    expect(seen).toEqual(['bad', 'good']);
  });
});

describe('storefront: B2B request', () => {
  it('prices the cart at the website prices for reference, with the number left to the database', async () => {
    const { db, calls } = fakeDb();
    const r = await handleStorefront('quote', { ...contact, items: b2bItems }, deps(db));
    expect(r.body).toMatchObject({ ok: true, quote: { number: 'XX-2026-0001', phone: '+212612345678', weightKg: 12, indicativeTotal: 1800, finalPrice: null } });
    const commit = calls.find((c) => c.name === 'commit_quote_request')!;
    expect(commit.args.p_subject).toContain(NUMBER_PLACEHOLDER);
    expect(counted(calls)).toHaveLength(2);
  });

  it('refuses contact errors, a city switched off, and carts that are not above the threshold, saving nothing', async () => {
    const { db, calls } = fakeDb();
    expect((await handleStorefront('quote', { ...contact, phone: '123', items: b2bItems }, deps(db))).body).toEqual({ ok: false, errors: ['phone'] });
    expect((await handleStorefront('quote', { ...contact, cityId: 'closed', items: b2bItems }, deps(db))).body).toEqual({ ok: false, errors: ['city'] });
    // one 250 g bag is an order, not a B2B request
    const small = [{ id: 'a', type: 'product', productId: 'horeca', size: 250, qty: 1 }];
    expect((await handleStorefront('quote', { ...contact, items: small }, deps(db))).status).toBe(400);
    // exactly at the threshold is still an order (isB2B is "above")
    const at = [{ id: 'a', type: 'product', productId: 'horeca', size: 1000, qty: 10 }];
    expect((await handleStorefront('quote', { ...contact, items: at }, deps(db))).status).toBe(400);
    const gone = [{ id: 'a', type: 'product', productId: 'gone', size: 1000, qty: 12 }];
    expect((await handleStorefront('quote', { ...contact, items: gone }, deps(db))).status).toBe(400);
    expect(committed(calls) || counted(calls).length > 0).toBe(false);
  });
});

describe('storefront: Turnstile answer', () => {
  const answer = (body: unknown) => (async () => new Response(JSON.stringify(body))) as unknown as typeof fetch;

  it('is verified only when Cloudflare says success', async () => {
    expect(await verifyTurnstile('s', 'token', null, answer({ success: true }))).toBe(true);
    expect(await verifyTurnstile('s', 'token', null, answer({ success: false }))).toBe(false);
  });

  it('fails closed: no token, an unreachable Cloudflare or a broken answer', async () => {
    let asked = false;
    const spy = (async () => ((asked = true), new Response('{"success":true}'))) as unknown as typeof fetch;
    expect(await verifyTurnstile('s', '', null, spy)).toBe(false);
    expect(asked).toBe(false);
    const down = (async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    expect(await verifyTurnstile('s', 'token', null, down)).toBe(false);
    expect(await verifyTurnstile('s', 'token', null, (async () => new Response('<html>')) as unknown as typeof fetch)).toBe(false);
  });
});
