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
    expect(knownErrors(['unavailable'], CHECKOUT_ERRORS)).toEqual(['server']);
    expect(knownErrors(['phone', 'unavailable', 'too_many'], CHECKOUT_ERRORS)).toEqual(['phone', 'server', 'too_many']);
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
