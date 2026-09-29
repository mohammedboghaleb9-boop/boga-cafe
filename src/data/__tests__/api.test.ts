/**
 * The demo data layer applies the core rules (review: undoing this wiring
 * left every core test green). Each test starts from a fresh demo store.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

async function fresh() {
  vi.resetModules();
  const [{ api }, { db }] = await Promise.all([import('../api'), import('../store')]);
  return { api, db };
}

let t: Awaited<ReturnType<typeof fresh>>;
beforeEach(async () => {
  t = await fresh();
});

const order = (where: (o: ReturnType<typeof t.db.get>['orders'][number]) => boolean) => t.db.get().orders.find(where)!;
const stockOf = (id: string) => t.db.get().origins.find((o) => o.id === id)!.stockKg;

describe('demo data layer', () => {
  it('keeps contact and recipients for the owner, free shipping for managers, nothing for staff', () => {
    const { api, db } = t;
    const s = db.get().settings;
    expect(api.saveSettings({ ...s, contact: { ...s.contact, whatsapp: '+212700000000' } }, 'manager')).toBe(false);
    expect(api.saveSettings({ ...s, notifications: { ...s.notifications, adminEmail: 'x@evil.example' } }, 'manager')).toBe(false);
    expect(api.saveSettings({ ...s, freeShippingOver: 999 }, 'staff')).toBe(false);
    expect(db.get().settings).toEqual(s);
    expect(api.saveSettings({ ...s, freeShippingOver: 999 }, 'manager')).toBe(true);
    expect(db.get().settings.freeShippingOver).toBe(999);
    expect(api.saveSettings({ ...s, contact: { ...s.contact, whatsapp: '+212700000000' } }, 'owner')).toBe(true);
    expect(db.get().settings.contact.whatsapp).toBe('+212700000000');
  });

  it('logs the stock change that really happened', () => {
    const { api, db } = t;
    const id = db.get().origins[0].id;
    const before = stockOf(id);
    api.adjustStock(id, -99_999, 'correction', 'casse');
    expect(stockOf(id)).toBe(0);
    expect(db.get().stockMovements[0]).toMatchObject({ originId: id, deltaKg: -before, note: 'casse' });
  });

  it('ignores a payment report on a cancelled order', async () => {
    const { api } = t;
    const o = order((x) => x.status === 'new' && x.paymentMethod !== 'card' && x.paymentStatus === 'pending');
    expect(api.setOrderStatus(o.id, 'cancelled')).toBeNull();
    await api.reportOfflinePayment(o.id, 'LATE-REF');
    expect(order((x) => x.id === o.id).paymentStatus).toBe('pending');
  });

  it('cancels an order refunded before production and gives its coffee back', () => {
    const { api, db } = t;
    const o = order((x) => x.status === 'confirmed' && x.paymentStatus === 'paid');
    const before = new Map(o.stockDeductions.map((d) => [d.originId, stockOf(d.originId)]));
    expect(api.setPaymentStatus(o.id, 'refunded', 'owner')).toBe(true);
    const after = order((x) => x.id === o.id);
    expect(after).toMatchObject({ status: 'cancelled', paymentStatus: 'refunded' });
    for (const d of o.stockDeductions) expect(stockOf(d.originId)).toBeCloseTo(before.get(d.originId)! + d.kg, 3);
    expect(db.get().stockMovements.filter((m) => m.ref === o.number && m.reason === 'order_cancelled')).toHaveLength(o.stockDeductions.length);
    // the order is closed: no second refund, no payment asked again
    expect(api.setPaymentStatus(o.id, 'refunded', 'owner')).toBe(false);
    expect(api.setPaymentStatus(o.id, 'paid', 'owner')).toBe(false);
  });

  it('refuses money changes from anyone but the owner', () => {
    const { api } = t;
    const o = order((x) => x.status === 'new' && x.paymentStatus === 'pending');
    expect(api.setPaymentStatus(o.id, 'paid', 'manager')).toBe(false);
    expect(api.setPaymentStatus(o.id, 'paid', 'staff')).toBe(false);
    expect(order((x) => x.id === o.id).paymentStatus).toBe('pending');
  });
});

describe('after the merge review', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const customer = { fullName: 'Test Client', phone: '0612345678', email: '', cityId: 'oujda', address: 'Bd Mohammed V, Oujda', company: '', notes: '' };
  const firstProduct = () => t.db.get().products.find((p) => p.active && p.kind !== 'b2b')!;

  it('refuses a card order while no card gateway is connected, and takes it in the prototype', async () => {
    const off = await fresh();
    const item = { id: 'i1', type: 'product' as const, productId: firstProduct().id, size: 250 as const, qty: 1 };
    const refused = await off.api.placeOrder({ items: [item], customer, paymentMethod: 'card', locale: 'fr' });
    expect(refused).toEqual({ ok: false, errors: ['payment_method'] });
    expect((await off.api.placeOrder({ items: [item], customer, paymentMethod: 'cashplus', locale: 'fr' })).ok).toBe(true);

    vi.stubEnv('VITE_CARD_GATEWAY', 'demo');
    const demo = await fresh();
    expect((await demo.api.placeOrder({ items: [item], customer, paymentMethod: 'card', locale: 'fr' })).ok).toBe(true);
  });

  it('tells the team when a customer reports a Cash Plus / transfer payment', async () => {
    const posts: { event: string; ref: string; whatsapp: string }[] = [];
    vi.stubEnv('VITE_NOTIFY_URL', '/api/notify');
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
      posts.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ whatsapp: 'sent', email: 'sent' }), { status: 200 });
    }));
    const { api, db } = await fresh();
    const o = db.get().orders.find((x) => x.status === 'new' && x.paymentMethod !== 'card' && x.paymentStatus === 'pending')!;
    const logsBefore = db.get().notifications.length;
    await api.reportOfflinePayment(o.id, 'CP-778812');

    const logs = db.get().notifications.slice(0, db.get().notifications.length - logsBefore);
    expect(logs.map((l) => `${l.event} ${l.channel}`).sort()).toEqual(['payment.reported email', 'payment.reported whatsapp']);
    expect(logs[0].body).toContain('CP-778812');
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ event: 'payment.reported', ref: o.number });
    expect(posts[0].whatsapp).toContain(`Paiement signalé ${o.number}`);

    // a second report does nothing: the payment is already waiting for checking
    await api.reportOfflinePayment(o.id, 'AUTRE');
    expect(posts).toHaveLength(1);
    expect(db.get().orders.find((x) => x.id === o.id)!.paymentRef).toBe('CP-778812');
  });
});

describe('admin protection (phase 2)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('adding a product with an existing name never replaces it', () => {
    const { api, db } = t;
    const original = db.get().products.find((p) => p.id === 'boga-signature')!;
    const draft = { ...original, id: '', slug: '', prices: { 250: 0, 500: 0, 1000: 0 }, active: false };
    const created = api.createProduct(draft);
    expect(created.id).toBe('boga-signature-2');
    expect(created.slug).toBe('boga-signature-2');
    expect(db.get().products.find((p) => p.id === 'boga-signature')).toEqual(original);
    expect(db.get().products.filter((p) => p.slug === 'boga-signature')).toHaveLength(1);
    // saving a product that does not exist creates nothing
    expect(api.saveProduct({ ...original, id: 'ghost', slug: 'ghost' })).toBe(false);
    expect(db.get().products.some((p) => p.id === 'ghost')).toBe(false);
  });

  it('adding an origin with an existing name never replaces it, and starts at 0 kg', () => {
    const { api, db } = t;
    const original = db.get().origins[0];
    const created = api.createOrigin({ ...original, id: '', pricePerKg: 999, stockKg: 50 });
    expect(created.id).not.toBe(original.id);
    expect(created.stockKg).toBe(0);
    expect(db.get().origins.find((o) => o.id === original.id)).toEqual(original);
    // a name whose id is already taken gets the next free one
    const twice = api.createOrigin({ ...original, id: '', name: { ...original.name, fr: created.name.fr } });
    expect(twice.id).toBe(`${created.id}-2`);
    expect(db.get().origins.find((o) => o.id === created.id)).toEqual(created);
  });

  it('editing an origin never changes its stock (only adjustStock does, with a history line)', () => {
    const { api, db } = t;
    const o = db.get().origins[0];
    expect(api.saveOrigin({ ...o, stockKg: 999, pricePerKg: o.pricePerKg + 10 })).toBe(true);
    const after = db.get().origins.find((x) => x.id === o.id)!;
    expect(after.stockKg).toBe(o.stockKg);
    expect(after.pricePerKg).toBe(o.pricePerKg + 10);
    expect(api.saveOrigin({ ...o, id: 'ghost' })).toBe(false);
  });

  it('cancelling an order gives its coffee back once, with a history line', () => {
    const { api, db } = t;
    const o = db.get().orders.find((x) => x.status === 'new')!;
    const before = new Map(o.stockDeductions.map((d) => [d.originId, stockOf(d.originId)]));
    expect(api.setOrderStatus(o.id, 'cancelled')).toBeNull();
    for (const d of o.stockDeductions) expect(stockOf(d.originId)).toBeCloseTo(before.get(d.originId)! + d.kg, 3);
    expect(db.get().stockMovements.filter((m) => m.ref === o.number && m.reason === 'order_cancelled')).toHaveLength(o.stockDeductions.length);
    expect(api.setOrderStatus(o.id, 'cancelled')).toBe('closed');
    for (const d of o.stockDeductions) expect(stockOf(d.originId)).toBeCloseTo(before.get(d.originId)! + d.kg, 3);
  });

  it('a card order cannot be "reported" as paid by Cash Plus or transfer', async () => {
    // a card order still waiting for the gateway (prototype build, where cards exist)
    vi.stubEnv('VITE_CARD_GATEWAY', 'demo');
    const { api, db } = await fresh();
    const product = db.get().products.find((p) => p.active && p.kind !== 'b2b')!;
    const placed = await api.placeOrder({
      items: [{ id: 'i1', type: 'product', productId: product.id, size: 250, qty: 1 }],
      customer: { fullName: 'Test Client', phone: '0612345678', email: '', cityId: 'oujda', address: 'Bd Mohammed V, Oujda', company: '', notes: '' },
      paymentMethod: 'card',
      locale: 'fr',
    });
    if (!placed.ok) throw new Error(placed.errors.join());
    expect(placed.order.paymentStatus).toBe('pending');
    await api.reportOfflinePayment(placed.order.id, 'FAKE');
    const after = db.get().orders.find((x) => x.id === placed.order.id)!;
    expect(after.paymentStatus).toBe('pending');
    expect(after.paymentRef).toBeUndefined();
  });
});
