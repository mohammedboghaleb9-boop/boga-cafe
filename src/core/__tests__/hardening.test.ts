import { describe, expect, it } from 'vitest';
import { balanceBlend } from '../blend';
import { isWellFormedItem, MAX_QTY_PER_LINE, summarizeCart } from '../cart';
import { buildOrder } from '../order';
import type { CartItem, CustomerInfo } from '../types';
import { origin, originIndex, product, rate, settings } from './fixtures';

const catalog = { products: [product], origins: originIndex };
const customer: CustomerInfo = {
  fullName: 'Yassine Test',
  phone: '06 12 34 56 78',
  email: '',
  cityId: 'oujda',
  address: 'Bd Mohammed V, Oujda',
  company: '',
  notes: '',
};
const ctx = {
  catalog,
  settings,
  shippingRates: [rate],
  paymentMethods: [{ id: 'bank_transfer' as const, enabled: true, label: product.name, instructions: product.name }],
};
const ids = { id: 'o1', number: 'BC-2026-7K4M2Q', now: '2026-09-27T10:00:00Z' };
const order = (items: unknown[]) => buildOrder({ items: items as CartItem[], customer, paymentMethod: 'bank_transfer', locale: 'fr' }, ctx, ids);
const p = (qty: unknown, size: unknown = 1000) => ({ id: String(Math.random()), type: 'product', productId: 'signature', size, qty });
const blend = (qty: unknown, size: unknown, lines = [{ originId: 'brazil', percent: 60 }, { originId: 'colombia', percent: 40 }]) => ({
  id: String(Math.random()),
  type: 'custom',
  qty,
  blend: { size, lines },
});

describe('tampered carts never become cheap or negative orders', () => {
  it.each([
    ['a negative line that cancels another', [p(1), p(-4, 250)]],
    ['a negative quantity alone', [p(-1, 250)]],
    ['a fraction of a bag', [p(0.25)]],
    ['zero bags', [p(0)]],
    ['no quantity', [p(null)]],
    ['a huge quantity', [p(MAX_QTY_PER_LINE + 1)]],
    ['a size that does not exist', [p(1, 20)]],
    ['a custom blend of 20 g', [blend(1, 20)]],
    ['a custom blend with a negative quantity', [p(2), blend(-1, 1000)]],
    ['a custom blend with fractional percentages', [blend(1, 1000, [{ originId: 'brazil', percent: 33.5 }, { originId: 'colombia', percent: 66.5 }])]],
  ])('refuses %s', (_label, items) => {
    const r = order(items);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toContain('cart_problem');
  });

  it('still accepts a normal cart', () => {
    const r = order([p(2, 250), blend(1, 500)]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.order.total).toBeGreaterThan(0);
      expect(r.order.stockDeductions.every((d) => d.kg > 0)).toBe(true);
    }
  });

  it('marks the bad line in the cart summary', () => {
    const s = summarizeCart([p(2, 250), p(-1, 250)] as CartItem[], catalog, settings);
    expect(s.hasProblems).toBe(true);
    expect(s.lines[1]).toMatchObject({ problem: 'invalid_quantity' });
  });

  it('drops malformed items read back from storage', () => {
    expect(isWellFormedItem(p(1))).toBe(true);
    expect(isWellFormedItem(blend(1, 500))).toBe(true);
    for (const bad of [p(-1), p(1.5), p(1, 300), blend(1, 20), { ...p(1), id: 3 }, null, 'x', { type: 'other', id: 'a', qty: 1 }]) {
      expect(isWellFormedItem(bad)).toBe(false);
    }
  });
});

describe('balance button', () => {
  const pct = (xs: number[], min = 5) => balanceBlend(xs.map((percent) => ({ percent })), min).map((l) => l.percent);

  it('keeps every coffee at the minimum (review case: 50 / 30 / 3)', () => {
    expect(pct([50, 30, 3])).toEqual([59, 36, 5]);
  });

  it('always reaches exactly 100 with whole numbers, never under the minimum', () => {
    for (const xs of [[1, 1, 98], [0, 0, 0, 100], [70, 70, 70], [0, 0], [2, 97], [10, 20, 30, 40]]) {
      const r = pct(xs);
      expect(r.reduce((a, b) => a + b, 0)).toBe(100);
      expect(Math.min(...r)).toBeGreaterThanOrEqual(5);
      expect(r.every(Number.isInteger)).toBe(true);
    }
  });

  it('keeps the old behaviour without a minimum', () => {
    expect(pct([0, 0, 0], 0)).toEqual([33, 33, 34]);
    expect(pct([50, 30, 30], 0).reduce((a, b) => a + b, 0)).toBe(100);
  });
});

describe('unpaid orders', () => {
  const base = { status: 'new', paymentStatus: 'pending', createdAt: '2026-09-25T10:00:00Z' };
  const o = (over: object) => ({ ...base, ...over }) as never;
  const now = new Date('2026-09-27T12:00:00Z'); // 50 h later

  it('cancels only new orders nobody paid or reported, after the time limit', async () => {
    const { expiredUnpaidOrders } = await import('../order');
    const orders = [
      o({ id: 'late' }),
      o({ id: 'failed-card', paymentStatus: 'failed' }),
      o({ id: 'reported', paymentStatus: 'awaiting_verification' }),
      o({ id: 'paid', paymentStatus: 'paid' }),
      o({ id: 'confirmed', status: 'confirmed' }),
      o({ id: 'recent', createdAt: '2026-09-26T10:00:00Z' }),
    ];
    expect(expiredUnpaidOrders(orders, 48, now).map((x: { id: string }) => x.id)).toEqual(['late', 'failed-card']);
    expect(expiredUnpaidOrders(orders, 0, now)).toEqual([]);
  });
});

describe('order status rules', () => {
  it('follows the steps, and nothing is produced or shipped before payment', async () => {
    const { statusChangeRefusal } = await import('../orderFlow');
    const o = (status: string, paymentStatus = 'pending') => ({ status, paymentStatus }) as never;
    expect(statusChangeRefusal(o('new'), 'confirmed')).toBeNull();
    expect(statusChangeRefusal(o('confirmed'), 'in_production')).toBe('needs_payment');
    expect(statusChangeRefusal(o('confirmed', 'paid'), 'in_production')).toBeNull();
    expect(statusChangeRefusal(o('new', 'paid'), 'shipped')).toBe('not_next');
    expect(statusChangeRefusal(o('shipped', 'paid'), 'delivered')).toBeNull();
  });

  it('cancels only before production, never a closed order', async () => {
    const { statusChangeRefusal } = await import('../orderFlow');
    const o = (status: string) => ({ status, paymentStatus: 'paid' }) as never;
    expect(statusChangeRefusal(o('new'), 'cancelled')).toBeNull();
    expect(statusChangeRefusal(o('confirmed'), 'cancelled')).toBeNull();
    expect(statusChangeRefusal(o('in_production'), 'cancelled')).toBe('too_late_to_cancel');
    expect(statusChangeRefusal(o('delivered'), 'cancelled')).toBe('closed');
    expect(statusChangeRefusal(o('cancelled'), 'new')).toBe('closed');
  });

  it('lets only the owner record payments, in a sensible order', async () => {
    const { canSetPayment } = await import('../orderFlow');
    const o = (paymentStatus: string, status = 'new') => ({ status, paymentStatus }) as never;
    expect(canSetPayment(o('pending'), 'paid', 'owner')).toBe(true);
    expect(canSetPayment(o('pending'), 'paid', 'manager')).toBe(false);
    expect(canSetPayment(o('pending'), 'paid', 'staff')).toBe(false);
    expect(canSetPayment(o('pending'), 'refunded', 'owner')).toBe(false);
    expect(canSetPayment(o('paid'), 'refunded', 'owner')).toBe(true);
    expect(canSetPayment(o('paid', 'cancelled'), 'refunded', 'owner')).toBe(true); // cancelled after paying: refund
    expect(canSetPayment(o('pending', 'cancelled'), 'paid', 'owner')).toBe(false);
  });
});

describe('refunds never leave an order stuck (review NEW-2, NEW-4)', () => {
  it('refunds before production, after cancellation or delivery, never mid-production', async () => {
    const { canSetPayment, statusChangeRefusal } = await import('../orderFlow');
    const o = (status: string, paymentStatus = 'paid') => ({ status, paymentStatus }) as never;
    for (const s of ['new', 'confirmed', 'cancelled', 'delivered']) expect(canSetPayment(o(s), 'refunded', 'owner')).toBe(true);
    for (const s of ['in_production', 'shipped']) expect(canSetPayment(o(s), 'refunded', 'owner')).toBe(false);
    // refunded before production: the order can still be cancelled
    expect(statusChangeRefusal(o('confirmed', 'refunded'), 'cancelled')).toBeNull();
  });

  it('records money that arrives after an automatic cancellation', async () => {
    const { canSetPayment } = await import('../orderFlow');
    const expired = (paymentStatus: string) => ({ status: 'cancelled', paymentStatus }) as never;
    expect(canSetPayment(expired('pending'), 'refunded', 'owner')).toBe(true);
    expect(canSetPayment(expired('awaiting_verification'), 'refunded', 'owner')).toBe(true);
    expect(canSetPayment(expired('pending'), 'paid', 'owner')).toBe(false);
    expect(canSetPayment(expired('refunded'), 'refunded', 'owner')).toBe(false);
    expect(canSetPayment(expired('pending'), 'refunded', 'manager')).toBe(false);
  });
});

describe('settings: managers change free shipping only (review NEW-3)', () => {
  it('keeps contact, notification recipients, bank and rules for the owner', async () => {
    const { settingsChangeRefused } = await import('../orderFlow');
    const edit = (patch: Partial<typeof settings>) => ({ ...settings, ...patch });
    expect(settingsChangeRefused(settings, edit({ freeShippingOver: settings.freeShippingOver + 100 }), 'manager')).toBe(false);
    expect(settingsChangeRefused(settings, edit({ contact: { ...settings.contact, whatsapp: '+212700000000' } }), 'manager')).toBe(true);
    expect(settingsChangeRefused(settings, edit({ notifications: { ...settings.notifications, adminEmail: 'x@evil.example' } }), 'manager')).toBe(true);
    expect(settingsChangeRefused(settings, edit({ bank: { ...settings.bank, rib: 'ATTACKER' } }), 'staff')).toBe(true);
    expect(settingsChangeRefused(settings, edit({ b2bThresholdKg: 1 }), 'manager')).toBe(true);
    expect(settingsChangeRefused(settings, edit({ contact: { ...settings.contact, whatsapp: '+212700000000' } }), 'owner')).toBe(false);
    // saving the same values again is not a change, whatever the order of the keys
    expect(settingsChangeRefused(settings, structuredClone(settings), 'manager')).toBe(false);
    const { rib, ...rest } = settings.bank;
    expect(settingsChangeRefused(settings, edit({ bank: { ...rest, rib } }), 'manager')).toBe(false);
    expect(settingsChangeRefused(settings, edit({ bank: { ...rest } as typeof settings.bank }), 'manager')).toBe(true);
    // staff change nothing, not even the free-shipping threshold
    expect(settingsChangeRefused(settings, edit({ freeShippingOver: settings.freeShippingOver + 100 }), 'staff')).toBe(true);
    expect(settingsChangeRefused(settings, structuredClone(settings), 'staff')).toBe(false);
  });
});

describe('manual stock changes (review NEW-5)', () => {
  it('never goes under 0 and reports the change that really happened', async () => {
    const { adjustOriginStock } = await import('../stock');
    const origins = [origin('a', { stockKg: 0.3 })];
    const out = adjustOriginStock(origins, 'a', -5);
    expect(out.origins[0].stockKg).toBe(0);
    expect(out.appliedKg).toBe(-0.3);
    const up = adjustOriginStock(origins, 'a', 2.5);
    expect(up.origins[0].stockKg).toBe(2.8);
    expect(up.appliedKg).toBe(2.5);
    expect(adjustOriginStock(origins, 'missing', 5)).toEqual({ origins, appliedKg: 0 });
  });
});

describe('stock returns add up across orders', () => {
  it('gives back every order, even when several used the same coffee', async () => {
    const { applyStock } = await import('../stock');
    const origins = [origin('a', { stockKg: 1 }), origin('b', { stockKg: 1 })];
    const back = applyStock(origins, [{ originId: 'a', kg: 0.5 }, { originId: 'b', kg: 0.2 }, { originId: 'a', kg: 0.25 }], 1);
    expect(back.map((o) => o.stockKg)).toEqual([1.75, 1.2]);
  });
});

describe('what the customer sees after a refund (review)', () => {
  it('never shows the payment steps again once refunded, cancelled or paid', async () => {
    const { awaitsPayment } = await import('../orderFlow');
    const o = (status: string, paymentStatus: string) => ({ status, paymentStatus }) as never;
    expect(awaitsPayment(o('new', 'pending'))).toBe(true);
    expect(awaitsPayment(o('confirmed', 'failed'))).toBe(true);
    for (const [status, pay] of [['delivered', 'refunded'], ['cancelled', 'pending'], ['confirmed', 'paid'], ['new', 'awaiting_verification']]) {
      expect(awaitsPayment(o(status, pay)), `${status}/${pay}`).toBe(false);
    }
  });

  it('tells a refunded customer so, whatever the order became', async () => {
    const { orderPhase } = await import('../orderFlow');
    const o = (status: string, paymentStatus: string) => ({ status, paymentStatus }) as never;
    expect(orderPhase(o('delivered', 'refunded'))).toBe('refunded');
    expect(orderPhase(o('cancelled', 'refunded'))).toBe('refunded');
    expect(orderPhase(o('cancelled', 'pending'))).toBe('cancelled');
    expect(orderPhase(o('delivered', 'paid'))).toBe('delivered');
    expect(orderPhase(o('confirmed', 'paid'))).toBe('paid');
    expect(orderPhase(o('new', 'awaiting_verification'))).toBe('awaiting_payment');
  });
});
