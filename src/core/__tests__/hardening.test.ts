import { describe, expect, it } from 'vitest';
import { balanceBlend } from '../blend';
import { isWellFormedItem, MAX_QTY_PER_LINE, summarizeCart } from '../cart';
import { buildOrder } from '../order';
import type { CartItem, CustomerInfo } from '../types';
import { originIndex, product, rate, settings } from './fixtures';

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
