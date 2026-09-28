/**
 * The demo data layer applies the core rules (review: undoing this wiring
 * left every core test green). Each test starts from a fresh demo store.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
