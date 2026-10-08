/**
 * The Admin Panel's data on the live site (slice 7, reads only): read once the session
 * is signed in at aal2, shown as an error (never as empty lists) when a read fails or
 * the database does not count the session as an admin, and dropped at sign-out.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminAuth, AdminSession } from '../../types';
import { createAdminData } from '../adminData';
import type { Client } from '../client';

const loc = (fr: string) => ({ ar: fr, fr, en: fr });
const PHONE = '0612345678';
const ORDER = '0b0b0b0b-1111-4222-8333-444444444444';

const tables: Record<string, unknown[]> = {
  origins: [
    { id: 'brazil', name: loc('Brésil'), country_code: 'BR', species: 'arabica', region: '', roast_level: 'medium', tasting_notes: loc(''),
      stock_kg: '0.500', low_stock_kg: 5, price_per_kg: 220, custom_blend_enabled: true, restock_date: null, active: false, updated_at: '' },
  ],
  products: [
    { id: 'hidden-blend', slug: 'hidden-blend', kind: 'signature', name: loc('Hidden'), tagline: loc(''), description: loc(''), roast_level: 'medium',
      tasting_notes: loc(''), prices: { 250: 60 }, image_url: null, featured: false, active: false, sort_order: 1, updated_at: '',
      product_recipes: [{ origin_id: 'brazil', percent: 100 }] },
  ],
  shipping_rates: [{ id: 'oujda', city: loc('Oujda'), distance_km: 0, base_fee: 20, included_kg: 3, extra_per_kg: 5, delivery_days: '1', active: false }],
  payment_methods: [{ id: 'cashplus', enabled: false, label: loc('Cash Plus'), instructions: loc('') }],
  site_config: [{ settings: {}, content: {} }],
  orders: [
    { id: ORDER, number: 'BC-2026-0001', created_at: '2026-10-06T10:00:00Z', locale: 'fr', customer_name: 'Amina', phone: PHONE, email: '', city_id: 'oujda',
      address: 'Rue 1', company: '', notes: '', lines: [], weight_kg: '0.250', subtotal: '60.00', shipping_fee: '20.00', total: '80.00',
      payment_method: 'cashplus', payment_status: 'pending', payment_ref: null, status: 'cancelled', stock_deductions: [{ originId: 'brazil', kg: '0.25' }],
      stock_returned: true,
      // the database keeps no order for embedded rows
      order_events: [{ at: '2026-10-06T12:00:00Z', label: 'status.cancelled' }, { at: '2026-10-06T10:00:00Z', label: 'order.created' }] },
  ],
  quote_requests: [
    { id: 'q1', number: 'QR-2026-0001', created_at: '2026-10-06T11:00:00Z', business_type: 'cafe', company: 'Café', contact_name: 'Youssef', phone: PHONE,
      email: '', city_id: 'oujda', lines: [], weight_kg: '30.000', indicative_total: '6000.00', notes: '', status: 'closed', final_price: null, admin_notes: 'TEST' },
  ],
  stock_movements: [{ id: 7, at: '2026-10-06T12:00:00Z', origin_id: 'brazil', delta_kg: '0.250', reason: 'order_cancelled', ref: 'BC-2026-0001', note: '', actor: null }],
  notification_outbox: [
    { id: 3, created_at: '2026-10-06T10:00:00Z', channel: 'whatsapp', event: 'order.created', recipient: '212600000000', subject: '', body: `Amina ${PHONE}`,
      status: 'pending', attempts: 0, last_error: null, sent_at: null },
  ],
  admin_config: [{ id: 1, admin_whatsapp: '212600000000', admin_email: 'team@example.test', whatsapp_on: true, email_on: false }],
};

interface Fake {
  failing?: Set<string>;
  /** what is_admin() answers for the session that read (default: true for the role asked) */
  isAdmin?: boolean;
  /** the role the database holds for this account, when is_admin() is asked for a list of roles */
  role?: string;
  /** answers wait for this before resolving */
  gate?: Promise<void>;
}

/** Enough of supabase-js for the reads: `asked` lists every table read and function called. */
function fakeClient(f: Fake) {
  const asked: string[] = [];
  const answer = async (table: string, single: boolean) => {
    await f.gate;
    if (f.failing?.has(table)) return { data: null, error: { code: '42501', message: `permission denied for table ${table}` } };
    return { data: single ? (tables[table][0] ?? null) : tables[table], error: null };
  };
  const from = (table: string) => {
    asked.push(table);
    const q = Object.assign(answer(table, false), {
      select: () => q,
      order: () => q,
      limit: () => q,
      eq: () => q,
      maybeSingle: () => answer(table, true),
    });
    return q;
  };
  const rpc = async (name: string, args?: { allowed?: string[] }) => {
    asked.push(`${name} ${args?.allowed?.join(',') ?? ''}`.trim());
    await f.gate;
    return { data: f.isAdmin ?? (!f.role || !args?.allowed || args.allowed.includes(f.role)), error: null };
  };
  return { client: { from, rpc } as unknown as Client, asked };
}

function fakeAuth(start: AdminSession) {
  let session = start;
  const listeners = new Set<() => void>();
  const auth: AdminAuth = {
    session: { get: () => session, subscribe: (l) => (listeners.add(l), () => listeners.delete(l)) },
    signIn: vi.fn(),
    signOut: vi.fn(),
    dismiss: vi.fn(),
    retry: vi.fn(),
  };
  const set = (s: AdminSession) => ((session = s), listeners.forEach((l) => l()));
  // like the real one: "checking", then placed again (by default where it was)
  let placeAgain: AdminSession = start;
  vi.mocked(auth.retry).mockImplementation(() => {
    set({ state: 'loading' });
    setTimeout(() => set(placeAgain), 0);
  });
  return { auth, set, placeAt: (s: AdminSession) => (placeAgain = s) };
}

/** The data store as the panel uses it: listened to, which starts the reads. */
function opened(f: Fake = {}, start: AdminSession = { state: 'signed_in', role: 'owner' }) {
  const fake = fakeClient(f);
  const { auth, set, placeAt } = fakeAuth(start);
  const data = createAdminData(() => fake.client, auth);
  data.status.subscribe(() => {});
  return { ...fake, auth, set, placeAt, data };
}

beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

describe('admin data (live site)', () => {
  it('reads every order with its events, the requests, movements, queued messages and the inactive catalog', async () => {
    const { data, asked } = opened();
    expect(data.status.get()).toBe('loading');
    await vi.waitFor(() => expect(data.status.get()).toBe('ready'));
    const s = data.db.get();
    expect(s.orders).toHaveLength(1);
    expect(s.orders[0]).toMatchObject({ number: 'BC-2026-0001', total: 80, status: 'cancelled', customer: { phone: PHONE } });
    expect(s.orders[0].history.map((h) => h.label)).toEqual(['order.created', 'status.cancelled']); // oldest first
    expect(s.quotes[0]).toMatchObject({ number: 'QR-2026-0001', weightKg: 30, indicativeTotal: 6000, finalPrice: null, adminNotes: 'TEST' });
    expect(s.stockMovements[0]).toEqual({ id: '7', at: '2026-10-06T12:00:00Z', originId: 'brazil', deltaKg: 0.25, reason: 'order_cancelled', ref: 'BC-2026-0001', note: '' });
    expect(s.notifications[0]).toMatchObject({ id: '3', channel: 'whatsapp', event: 'order.created', status: 'pending' });
    expect(s.products.map((p) => p.active)).toEqual([false]);
    expect(s.settings.notifications).toMatchObject({ adminEmail: 'team@example.test', emailEnabled: false }); // owner: admin_config
    expect(asked.at(-1)).toBe('is_admin owner'); // asked after the reads, for the role shown
  });

  it('reads only what the role may read: staff no messages nor recipients, a manager no recipients', async () => {
    for (const [role, skipped] of [['staff', ['notification_outbox', 'admin_config']], ['manager', ['admin_config']]] as const) {
      const { data, asked } = opened({}, { state: 'signed_in', role });
      await vi.waitFor(() => expect(data.status.get()).toBe('ready'));
      for (const table of skipped) expect(asked).not.toContain(table);
      expect(asked).toContain('orders');
      expect(data.db.get().settings.notifications.adminEmail).toBe('');
    }
  });

  it('shows an error, not empty lists, when the database does not count the session as an admin; the sign-in is checked again once', async () => {
    const { data, auth, asked } = opened({ isAdmin: false });
    await vi.waitFor(() => expect(auth.retry).toHaveBeenCalledTimes(1));
    // the check placed it back in the panel (they disagree): read again, then the error, no loop
    await vi.waitFor(() => expect(asked.filter((a) => a.startsWith('is_admin'))).toHaveLength(2));
    await vi.waitFor(() => expect(data.status.get()).toBe('error'));
    expect(data.db.get().orders).toEqual([]);
    await new Promise((r) => setTimeout(r, 10));
    expect(auth.retry).toHaveBeenCalledTimes(1);
  });

  it('an owner made manager meanwhile reads no recipients: an error, and the role is read again', async () => {
    const { data, auth, placeAt, asked } = opened({ role: 'manager' });
    placeAt({ state: 'signed_in', role: 'manager' });
    await vi.waitFor(() => expect(auth.retry).toHaveBeenCalledTimes(1));
    expect(asked).toContain('is_admin owner');
    await vi.waitFor(() => expect(data.status.get()).toBe('ready'));
    expect(asked.at(-1)).toBe('is_admin manager');
    expect(asked.filter((a) => a === 'admin_config')).toHaveLength(1); // the second read, as manager, skips it
  });

  it('after a new sign-in, a disagreement checks the sign-in again (aal1 back to the code)', async () => {
    const f: Fake = { isAdmin: false };
    const { data, auth, set, placeAt } = opened(f);
    placeAt({ state: 'second_factor', enrolled: true });
    await vi.waitFor(() => expect(auth.retry).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(data.status.get()).toBe('loading')); // the code screen: nothing kept
    set({ state: 'signed_in', role: 'owner' });
    await vi.waitFor(() => expect(auth.retry).toHaveBeenCalledTimes(2));
  });

  it('shows an error when a read fails, logs no customer detail, and reads again on "try again"', async () => {
    const failing = new Set(['orders']);
    const { data } = opened({ failing });
    await vi.waitFor(() => expect(data.status.get()).toBe('error'));
    const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logged).toContain('42501');
    expect(logged).not.toContain(PHONE);
    failing.clear();
    data.reload();
    await vi.waitFor(() => expect(data.status.get()).toBe('ready'));
    expect(data.db.get().orders).toHaveLength(1);
  });

  it('drops everything at sign-out, even an answer still on its way, and reads again at the next sign-in', async () => {
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    const { data, set, asked } = opened({ gate });
    set({ state: 'signed_out' });
    open();
    await new Promise((r) => setTimeout(r, 5));
    expect(data.status.get()).toBe('loading');
    expect(data.db.get().orders).toEqual([]);

    set({ state: 'second_factor', enrolled: true });
    expect(asked.filter((t) => t === 'orders')).toHaveLength(1); // nothing read before aal2
    set({ state: 'signed_in', role: 'owner' });
    await vi.waitFor(() => expect(data.status.get()).toBe('ready'));
    expect(asked.filter((t) => t === 'orders')).toHaveLength(2);
    set({ state: 'second_factor', enrolled: true }); // back to the code: the panel's data goes too
    expect(data.db.get().orders).toEqual([]);
  });
});
