/**
 * Orders on the live site: the placed order stays readable in the tab (with
 * the phone and address the server never sends back), a link opened elsewhere
 * is read from the server, and a failed send never throws at the form.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Order } from '@/core/types';
import { createSupabaseApi, knownErrors } from '../api';
import { CHECKOUT_ERRORS } from '@/core/order';
import type { Client } from '../client';
import { orderSent } from '../orderKey';
import { createCatalogStore } from '../store';

const ID = '11111111-2222-3333-4444-555555555555';
const placed = {
  id: ID, number: 'BC-2026-0002', createdAt: '2026-10-06T10:00:00Z', locale: 'fr',
  customer: { fullName: 'Salma Test', phone: '0612345678', email: '', cityId: 'oujda', address: 'Rue 1, Oujda', company: '', notes: '' },
  lines: [], weightKg: 0.25, subtotal: 65, shippingFee: 20, total: 85, paymentMethod: 'bank_transfer', paymentStatus: 'pending',
  status: 'new', stockDeductions: [], history: [],
} as unknown as Order;
const publicRow = { number: 'BC-2026-0002', created_at: '2026-10-06T10:00:00Z', customer_name: 'Salma Test', city_id: 'oujda', lines: [],
  weight_kg: 0.25, subtotal: 65, shipping_fee: 20, total: 85, payment_method: 'bank_transfer', payment_status: 'paid', status: 'confirmed' };

type Rpc = (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
const okRpc: Rpc = async (name) => (name === 'get_order_public' ? { data: [publicRow], error: null } : { data: null, error: null });

function setup(reply: () => Promise<Response>, rpcImpl: Rpc = okRpc) {
  const rpc = vi.fn(rpcImpl);
  const client = { rpc, from: () => { throw new Error('no catalog read in these tests'); } } as unknown as Client;
  const store = createCatalogStore(client);
  const api = createSupabaseApi({ client, store, storefront: { url: 'https://p.supabase.co', key: 'k', fetchFn: reply as unknown as typeof fetch } });
  return { api, store, rpc };
}

describe('orders on the live site', () => {
  beforeEach(() => {
    const saved = new Map<string, string>();
    vi.stubGlobal('sessionStorage', { getItem: (k: string) => saved.get(k) ?? null, setItem: (k: string, v: string) => saved.set(k, v) });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('keeps the placed order for the tab, then shows the status the server has now', async () => {
    const tab = setup(async () => new Response(JSON.stringify({ ok: true, order: placed }), { status: 200 }));
    const r = await tab.api.placeOrder({ items: [], customer: placed.customer, paymentMethod: 'bank_transfer', locale: 'fr' });
    expect(r).toEqual({ ok: true, order: placed });
    expect(tab.store.db.get().orders[0].customer.phone).toBe('0612345678');

    // the page is reloaded: a fresh store, the same tab
    const reloaded = setup(async () => new Response('', { status: 500 }));
    await reloaded.api.loadOrder(ID);
    const o = reloaded.store.db.get().orders[0];
    expect(o.customer.address).toBe('Rue 1, Oujda'); // from this tab's copy
    expect([o.paymentStatus, o.status]).toEqual(['paid', 'confirmed']); // from the server
  });

  it('reads a link opened on another device from the server, without private details', async () => {
    vi.stubGlobal('sessionStorage', { getItem: () => null, setItem: () => {} });
    const other = setup(async () => new Response('', { status: 500 }));
    await other.api.loadOrder(ID);
    expect(other.store.db.get().orders[0]).toMatchObject({ number: 'BC-2026-0002', customer: { phone: '', address: '' } });
    // not an order link: no call at all
    await other.api.loadOrder('not-an-id');
    expect(other.rpc).toHaveBeenCalledTimes(1);
  });

  const contact = { businessType: 'cafe' as const, company: '', contactName: 'Amine', phone: '0612345678', email: '', cityId: 'oujda', notes: '' };

  it('never throws at the B2B form when the connection is lost, and builds the customer\'s message on success', async () => {
    const offline = setup(() => Promise.reject(new TypeError('Failed to fetch')));
    await expect(offline.api.requestQuote({ ...contact, items: [] })).resolves.toEqual({ ok: false, errors: ['server'] });

    const quote = { id: 'q1', number: 'QR-2026-0009', createdAt: '2026-10-06T10:00:00Z', businessType: 'cafe', company: '', contactName: 'Amine',
      phone: '+212612345678', email: '', cityId: 'oujda', lines: [], weightKg: 11, indicativeTotal: 1000, notes: '', status: 'new' };
    const online = setup(async () => new Response(JSON.stringify({ ok: true, quote }), { status: 200 }));
    const r = await online.api.requestQuote({ ...contact, items: [] });
    if (!r.ok) throw new Error(r.errors.join());
    expect(r.message.whatsapp).toContain('QR-2026-0009');
  });

  it('shows a refusal this site does not know as "server", never as nothing', async () => {
    expect(knownErrors(['a_newer_code'], CHECKOUT_ERRORS)).toEqual(['server']);
    expect(knownErrors(['phone', 'a_newer_code', 'too_many'], CHECKOUT_ERRORS)).toEqual(['phone', 'server', 'too_many']);
    // slice 3b's refusal is one the order form shows; a B2B form has no such message
    expect(knownErrors(['unavailable'], CHECKOUT_ERRORS)).toEqual(['unavailable']);
    const newer = setup(async () => new Response(JSON.stringify({ ok: false, errors: ['unavailable'] }), { status: 200 }));
    expect(await newer.api.requestQuote({ ...contact, items: [] })).toEqual({ ok: false, errors: ['server'] });
  });

  it('reports a payment by RPC, shows the new status, and says when it could not be sent', async () => {
    const tab = setup(async () => new Response(JSON.stringify({ ok: true, order: placed }), { status: 200 }), async (name) =>
      name === 'get_order_public' ? { data: [{ ...publicRow, payment_status: 'awaiting_verification', status: 'new' }], error: null } : { data: null, error: null });
    await tab.api.placeOrder({ items: [], customer: placed.customer, paymentMethod: 'bank_transfer', locale: 'fr' });
    expect(await tab.api.reportOfflinePayment(ID, '  CP-778812  ')).toBe(true);
    expect(tab.rpc).toHaveBeenCalledWith('report_offline_payment', { p_order_id: ID, p_ref: 'CP-778812' });
    expect(tab.store.db.get().orders[0]).toMatchObject({ paymentStatus: 'awaiting_verification', paymentRef: 'CP-778812', customer: { phone: '0612345678' } });

    const down = setup(async () => new Response('', { status: 500 }), async () => ({ data: null, error: { message: 'offline' } }));
    expect(await down.api.reportOfflinePayment(ID, 'CP-1')).toBe(false);
  });

  it('says the order could not be read only when this tab has no copy of it', async () => {
    const failing: Rpc = async () => ({ data: null, error: { message: 'offline' } });
    vi.stubGlobal('sessionStorage', { getItem: () => null, setItem: () => {} });
    await expect(setup(async () => new Response(''), failing).api.loadOrder(ID)).rejects.toBeTruthy();

    const saved = new Map([['boga.orders', JSON.stringify([placed])]]);
    vi.stubGlobal('sessionStorage', { getItem: (k: string) => saved.get(k) ?? null, setItem: () => {} });
    const withCopy = setup(async () => new Response(''), failing);
    await expect(withCopy.api.loadOrder(ID)).resolves.toBeUndefined();
    expect(withCopy.store.db.get().orders[0].customer.address).toBe('Rue 1, Oujda');
  });
});

describe('the idempotency key of an order', () => {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const stored = new Map<string, string>();
  beforeEach(() => {
    stored.clear();
    orderSent();
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => stored.get(k) ?? null,
      setItem: (k: string, v: string) => stored.set(k, v),
      removeItem: (k: string) => stored.delete(k),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('is the same when the same order is sent again, new when it changes or once an order went through', async () => {
    const keys: string[] = [];
    let answer = () => new Response('', { status: 502 }); // the answer is lost
    const fetchFn = async (_: string, init: RequestInit) => (keys.push(JSON.parse(init.body as string).idempotencyKey), answer());
    const { api } = setup(fetchFn as never);
    const input = { items: [], customer: placed.customer, paymentMethod: 'bank_transfer' as const, locale: 'fr' as const };

    expect(await api.placeOrder(input)).toEqual({ ok: false, errors: ['server'] });
    await api.placeOrder(input); // sent again
    await api.placeOrder({ ...input, locale: 'ar' }); // same order, another language
    expect(keys[0]).toMatch(UUID);
    expect(keys.slice(1)).toEqual([keys[0], keys[0]]);
    // kept for a reload of the tab, without the customer's details
    expect(stored.get('boga.orderAttempt')).toContain(keys[0]);
    expect(stored.get('boga.orderAttempt')).not.toContain('0612345678');

    await api.placeOrder({ ...input, customer: { ...input.customer, address: 'Rue 2, Oujda' } }); // corrected: another order
    expect(keys[3]).not.toBe(keys[0]);
    answer = () => new Response(JSON.stringify({ ok: true, order: placed }), { status: 200 });
    await api.placeOrder({ ...input, customer: { ...input.customer, address: 'Rue 2, Oujda' } });
    expect(keys[4]).toBe(keys[3]);
    // it went through: the same cart ordered again is a new order
    await api.placeOrder({ ...input, customer: { ...input.customer, address: 'Rue 2, Oujda' } });
    expect(new Set(keys).size).toBe(3);
    expect(stored.has('boga.orderAttempt')).toBe(false); // nothing left once an order went through
  });

  it('sends the Turnstile token with each form, a fresh one on a resend that keeps the same order key', async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetchFn = async (_: string, init: RequestInit) => (bodies.push(JSON.parse(init.body as string)), new Response('', { status: 502 }));
    const { api } = setup(fetchFn as never);
    const input = { items: [], customer: placed.customer, paymentMethod: 'bank_transfer' as const, locale: 'fr' as const };
    await api.placeOrder(input, { captchaToken: 'token-1' });
    await api.placeOrder(input, { captchaToken: 'token-2' }); // a token works once: the resend has a new one
    await api.requestQuote({ businessType: 'cafe', company: 'Café', contactName: 'Amine', phone: '0612345678', email: '', cityId: 'oujda', notes: '', items: [] }, { captchaToken: 'token-3' });
    expect(bodies.map((b) => b.captchaToken)).toEqual(['token-1', 'token-2', 'token-3']);
    expect(bodies[1].idempotencyKey).toBe(bodies[0].idempotencyKey);
  });

  it('keeps the key in memory when the tab cannot store it, and sends none without Web Crypto', async () => {
    vi.stubGlobal('sessionStorage', { getItem: () => null, setItem: () => { throw new Error('private mode'); }, removeItem: () => {} });
    const bodies: Record<string, unknown>[] = [];
    const fetchFn = async (_: string, init: RequestInit) => (bodies.push(JSON.parse(init.body as string)), new Response('', { status: 502 }));
    const { api } = setup(fetchFn as never);
    const input = { items: [], customer: placed.customer, paymentMethod: 'bank_transfer' as const, locale: 'fr' as const };
    await api.placeOrder(input);
    await api.placeOrder(input);
    expect(bodies[0].idempotencyKey).toMatch(UUID);
    expect(bodies[1].idempotencyKey).toBe(bodies[0].idempotencyKey);
    // a page on plain http has no crypto.subtle: the order still goes, without a key
    vi.stubGlobal('crypto', {});
    expect(await api.placeOrder(input)).toEqual({ ok: false, errors: ['server'] });
    expect(bodies[2]).not.toHaveProperty('idempotencyKey');
    expect(bodies[2].customer).toEqual(input.customer);
  });

  it('starts a new key after a day: a tab restored later places a new order', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const keys: string[] = [];
      const fetchFn = async (_: string, init: RequestInit) => (keys.push(JSON.parse(init.body as string).idempotencyKey), new Response('', { status: 502 }));
      const { api } = setup(fetchFn as never);
      const input = { items: [], customer: placed.customer, paymentMethod: 'bank_transfer' as const, locale: 'fr' as const };
      vi.setSystemTime(new Date('2026-10-07T10:00:00Z'));
      await api.placeOrder(input);
      vi.setSystemTime(new Date('2026-10-08T09:59:00Z'));
      await api.placeOrder(input);
      vi.setSystemTime(new Date('2026-10-08T10:01:00Z'));
      await api.placeOrder(input);
      expect(keys[1]).toBe(keys[0]);
      expect(keys[2]).not.toBe(keys[0]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('a product the server says is unavailable', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reads the catalog again without the loading screen, so the cart shows which line it is', async () => {
    vi.stubGlobal('sessionStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
    let stock = 5;
    const tables = () => ({
      origins: [{ id: 'ethiopia', name: {}, country_code: 'ET', species: 'arabica', region: '', roast_level: 'light', tasting_notes: {}, stock_kg: stock, low_stock_kg: 1, price_per_kg: 300, custom_blend_enabled: false, restock_date: null, active: true }],
      products: [], shipping_rates: [], payment_methods: [],
    });
    const from = vi.fn((table: string) => {
      const result = { data: (tables() as Record<string, unknown[]>)[table] ?? [], error: null };
      const q = Object.assign(Promise.resolve(result), { select: () => q, order: () => q, eq: () => q, maybeSingle: async () => ({ data: { settings: {}, content: {} }, error: null }) });
      return q;
    });
    const client = { rpc: vi.fn(), from } as unknown as Client;
    const store = createCatalogStore(client);
    const reply = async () => new Response(JSON.stringify({ ok: false, errors: ['unavailable', 'payment_method'] }), { status: 200 });
    const api = createSupabaseApi({ client, store, storefront: { url: 'https://p.supabase.co', key: 'k', fetchFn: reply as unknown as typeof fetch } });
    await store.load();
    const seen: string[] = [];
    store.status.subscribe(() => seen.push(store.status.get()));
    stock = 0; // emptied since the page loaded
    const r = await api.placeOrder({ items: [], customer: placed.customer, paymentMethod: 'bank_transfer', locale: 'fr' });
    expect(r).toEqual({ ok: false, errors: ['unavailable', 'payment_method'] });
    expect(store.db.get().origins[0].stockKg).toBe(0);
    expect(seen).not.toContain('loading');
    expect(store.status.get()).toBe('ready');
    // the network drops during that read: the page keeps the copy it has, no error screen
    vi.spyOn(console, 'error').mockImplementation(() => {});
    from.mockImplementation(() => {
      throw new Error('offline');
    });
    await api.placeOrder({ items: [], customer: placed.customer, paymentMethod: 'bank_transfer', locale: 'fr' });
    expect([store.status.get(), store.db.get().origins.length]).toEqual(['ready', 1]);
  });
});
