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

describe('real site data (audit H4)', () => {
  it('starts with the catalog only: no example customers, and nowhere to pay until the real account exists', async () => {
    const [{ initialState }, { storefrontCheckoutContext }] = await Promise.all([import('../store'), import('../context')]);
    const s = initialState(false);
    expect([s.orders, s.samples, s.quotes, s.notifications, s.stockMovements].map((x) => x.length)).toEqual([0, 0, 0, 0, 0]);
    expect(s.settings.bank).toEqual({ holder: '', bankName: '', rib: '' });
    expect(s.settings.cashplus).toEqual({ beneficiary: '' });
    expect(storefrontCheckoutContext(s).paymentMethods.filter((m) => m.enabled)).toEqual([]);
    // the demo store, by contrast, can take the tests' orders
    expect(storefrontCheckoutContext(initialState(true)).paymentMethods.filter((m) => m.enabled).map((m) => m.id).sort()).toEqual(['bank_transfer', 'cashplus']);
  });
});

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

  it('frees the stock of a reported payment nobody confirmed, never of a paid order (audit H3)', async () => {
    const { api, db } = t;
    const claim = order((x) => x.status === 'new' && x.paymentMethod !== 'card' && x.paymentStatus === 'pending');
    await api.reportOfflinePayment(claim.id, 'REF-1');
    const paid = order((x) => x.paymentStatus === 'paid' && x.status === 'confirmed');
    const old = new Date(Date.now() - 121 * 3_600_000).toISOString();
    db.update((s) => ({ ...s, orders: s.orders.map((o) => (o.id === claim.id || o.id === paid.id ? { ...o, createdAt: old } : o)) }));
    const before = new Map(claim.stockDeductions.map((d) => [d.originId, stockOf(d.originId)]));
    expect(api.expireUnpaidOrders()).toBeGreaterThanOrEqual(1);
    expect(order((x) => x.id === claim.id).status).toBe('cancelled');
    expect(order((x) => x.id === paid.id).status).toBe('confirmed');
    for (const d of claim.stockDeductions) expect(stockOf(d.originId)).toBeCloseTo(before.get(d.originId)! + d.kg, 3);
    expect(api.expireUnpaidOrders()).toBe(0); // given back once
    // staff cannot cancel the paid one either: the owner refunds it
    expect(api.setOrderStatus(paid.id, 'cancelled', 'staff')).toBe('refund_instead');
    expect(order((x) => x.id === paid.id).status).toBe('confirmed');
  });

  it('ignores a payment report on a cancelled order', async () => {
    const { api } = t;
    const o = order((x) => x.status === 'new' && x.paymentMethod !== 'card' && x.paymentStatus === 'pending');
    expect(api.setOrderStatus(o.id, 'cancelled', 'staff')).toBeNull();
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

  it('an order takes its coffee from stock in the history, and warns the team when an origin runs low (audit M2)', async () => {
    const { api, db } = t;
    const product = firstProduct();
    const originId = product.recipe[0].originId;
    // just above the alert threshold: one bag crosses it
    db.update((s) => ({ ...s, origins: s.origins.map((o) => (o.id === originId ? { ...o, stockKg: o.lowStockKg + 0.1 } : o)) }));
    const placed = await api.placeOrder({ items: [{ id: 'i1', type: 'product', productId: product.id, size: 250, qty: 1 }], customer, paymentMethod: 'bank_transfer', locale: 'fr' });
    if (!placed.ok) throw new Error(placed.errors.join());
    const moves = db.get().stockMovements.filter((m) => m.ref === placed.order.number);
    expect(moves.length).toBe(placed.order.stockDeductions.length);
    for (const m of moves) expect(m.deltaKg).toBeLessThan(0);
    expect(db.get().notifications.some((n) => n.event === 'stock.low' && n.body.includes(db.get().origins.find((o) => o.id === originId)!.name.fr))).toBe(true);
  });

  it('checks what customers send: B2B sample product and city, a capped payment reference, no card payment on a transfer (audit M2)', async () => {
    const { api, db } = t;
    const contact = { businessType: 'cafe' as const, company: 'Café Test', contactName: 'Sara Test', phone: '0661000000', email: '', cityId: 'oujda', notes: '' };
    const b2b = db.get().products.find((p) => p.kind === 'b2b' && p.active)!;
    const retail = firstProduct();
    expect((await api.requestSample({ ...contact, productId: b2b.id, estMonthlyKg: 20 })).ok).toBe(true);
    expect(await api.requestSample({ ...contact, productId: retail.id, estMonthlyKg: 20 })).toMatchObject({ ok: false, errors: ['product'] });
    expect(await api.requestSample({ ...contact, cityId: 'atlantis', productId: b2b.id, estMonthlyKg: 20 })).toMatchObject({ ok: false, errors: ['city'] });

    const transfer = order((x) => x.status === 'new' && x.paymentMethod === 'bank_transfer' && x.paymentStatus === 'pending');
    await api.completeCardPayment(transfer.id, true); // a card answer never pays a transfer
    expect(order((x) => x.id === transfer.id).paymentStatus).toBe('pending');
    await api.reportOfflinePayment(transfer.id, `REF-${'9'.repeat(200)}`);
    expect(order((x) => x.id === transfer.id).paymentRef).toHaveLength(80);
  });

  it('forgets browser data saved by an older version of the site', async () => {
    const saved = new Map([['boga-cafe-demo-db', JSON.stringify({ version: 1, orders: [{ id: 'stale' }] })]]);
    vi.stubGlobal('localStorage', { getItem: (k: string) => saved.get(k) ?? null, setItem: (k: string, v: string) => saved.set(k, v), removeItem: () => {} });
    const { db } = await fresh();
    expect(db.get().orders.some((o) => o.id === 'stale')).toBe(false);
    expect(db.get().version).toBeGreaterThan(1);
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
    const created = api.createOrigin({ ...original, id: '', pricePerKg: 999, stockKg: 50 })!;
    expect(created.id).not.toBe(original.id);
    expect(created.stockKg).toBe(0);
    expect(db.get().origins.find((o) => o.id === original.id)).toEqual(original);
    // a name whose id is already taken gets the next free one
    const twice = api.createOrigin({ ...original, id: '', name: { ...original.name, fr: created.name.fr } })!;
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
    expect(api.setOrderStatus(o.id, 'cancelled', 'staff')).toBeNull();
    for (const d of o.stockDeductions) expect(stockOf(d.originId)).toBeCloseTo(before.get(d.originId)! + d.kg, 3);
    expect(db.get().stockMovements.filter((m) => m.ref === o.number && m.reason === 'order_cancelled')).toHaveLength(o.stockDeductions.length);
    expect(api.setOrderStatus(o.id, 'cancelled', 'staff')).toBe('closed');
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

describe('phase 2 review', () => {
  it('a product id or address already in use, either one, is never reused', () => {
    const { api, db } = t;
    const base = db.get().products[0];
    db.update((s) => ({ ...s, products: [...s.products, { ...base, id: 'only-id', slug: 'only-slug' }] }));
    expect(api.createProduct({ ...base, name: { ...base.name, fr: 'Only id' } }).id).toBe('only-id-2');
    expect(api.createProduct({ ...base, name: { ...base.name, fr: 'Only slug' } }).id).toBe('only-slug-2');
    // "new" is the address of the add-product form
    expect(api.createProduct({ ...base, name: { ...base.name, fr: 'New' } }).id).toBe('new-2');
  });

  it('refuses an origin without a real price per kg', () => {
    const { api, db } = t;
    const o = db.get().origins[0];
    for (const bad of [0, 0.4, -50, Number.NaN]) {
      expect(api.saveOrigin({ ...o, pricePerKg: bad }), String(bad)).toBe(false);
      expect(api.createOrigin({ ...o, id: '', name: { ...o.name, fr: `Test ${bad}` }, pricePerKg: bad }), String(bad)).toBeNull();
    }
    expect(db.get().origins.find((x) => x.id === o.id)!.pricePerKg).toBe(o.pricePerKg);
  });
});
