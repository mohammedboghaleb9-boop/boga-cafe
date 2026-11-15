/**
 * Cash on delivery (owner 2026-11-10): the same rules as supabase/migrations/20261110120000_cod.sql, which
 * supabase/tests/cod.sql checks on the database side.
 */
import { describe, expect, it } from 'vitest';
import { COD_UNCONFIRMED_HOURS, expiredUnpaidOrders, reservationDeadline, validateCustomer } from '../order';
import { canReportPayment, canSetPayment, deliveryFailureRefusal, moneyToCheck, orderPhase, statusChangeRefusal } from '../orderFlow';
import { salesReport } from '../reports';
import type { Order, OrderStatus, PaymentMethodId, PaymentStatus } from '../types';

const order = (status: OrderStatus, paymentStatus: PaymentStatus, paymentMethod: PaymentMethodId = 'cod') => ({ status, paymentStatus, paymentMethod });

describe('cash on delivery: the delivery steps', () => {
  it('prepares, ships and delivers an unpaid cod order, never an unpaid prepaid one', () => {
    expect(statusChangeRefusal(order('confirmed', 'pending'), 'in_production', 'staff')).toBeNull();
    expect(statusChangeRefusal(order('in_production', 'pending'), 'shipped', 'staff')).toBeNull();
    expect(statusChangeRefusal(order('shipped', 'pending'), 'delivered', 'owner')).toBeNull();
    for (const m of ['cashplus', 'bank_transfer', 'card'] as const) {
      expect(statusChangeRefusal(order('confirmed', 'pending', m), 'in_production', 'owner'), m).toBe('needs_payment');
    }
  });

  it('a failed delivery wants its reason, is tried again or comes back, and is never cancelled', () => {
    expect(statusChangeRefusal(order('shipped', 'pending'), 'delivery_failed', 'owner')).toBe('reason_required');
    expect(deliveryFailureRefusal(order('shipped', 'pending'), ' Client  absent ')).toBeNull();
    expect(deliveryFailureRefusal(order('shipped', 'pending'), '  x ')).toBe('invalid_reason');
    expect(deliveryFailureRefusal(order('shipped', 'pending'), 'x'.repeat(201))).toBe('invalid_reason');
    expect(deliveryFailureRefusal(order('confirmed', 'pending'), 'Client absent')).toBe('not_next');
    // a prepaid order is BOGA's money already: it never takes this path (no refund rule for it)
    expect(deliveryFailureRefusal(order('shipped', 'paid', 'cashplus'), 'Client absent')).toBe('not_next');
    expect(statusChangeRefusal(order('delivery_failed', 'pending'), 'shipped', 'staff')).toBeNull();
    expect(statusChangeRefusal(order('delivery_failed', 'pending'), 'returned', 'staff')).toBeNull();
    expect(statusChangeRefusal(order('delivery_failed', 'pending'), 'delivered', 'staff')).toBe('not_next');
    expect(statusChangeRefusal(order('delivery_failed', 'pending'), 'cancelled', 'owner')).toBe('too_late_to_cancel');
    expect(statusChangeRefusal(order('returned', 'pending'), 'shipped', 'owner')).toBe('closed');
  });
});

describe('cash on delivery: the delivery, the owner\'s alone (owner, 2026-11-14)', () => {
  it('only the owner marks a cod order delivered; a prepaid one keeps its rule', () => {
    expect(statusChangeRefusal(order('shipped', 'pending'), 'delivered', 'owner')).toBeNull();
    for (const role of ['manager', 'staff'] as const) {
      expect(statusChangeRefusal(order('shipped', 'pending'), 'delivered', role), role).toBe('owner_only');
      // every step before it stays any admin's
      expect(statusChangeRefusal(order('new', 'pending'), 'confirmed', role), role).toBeNull();
      expect(statusChangeRefusal(order('in_production', 'pending'), 'shipped', role), role).toBeNull();
      expect(statusChangeRefusal(order('shipped', 'paid', 'cashplus'), 'delivered', role), role).toBeNull();
    }
  });
});

describe('cash on delivery: an order nobody confirmed ends after 24 hours (owner, 2026-11-14)', () => {
  const settings = { unpaidOrderTimeoutHours: 48, paymentCheckTimeoutHours: 120 };
  const placed = '2026-11-15T10:00:00.000Z';
  const at = (hours: number) => new Date(new Date(placed).getTime() + hours * 3_600_000);
  const cod = (status: OrderStatus) => ({ ...order(status, 'pending'), id: status, createdAt: placed }) as unknown as Order;

  it('the deadline is 24 hours after it was placed, while it is new; confirmed, it has none', () => {
    expect(COD_UNCONFIRMED_HOURS).toBe(24);
    expect(reservationDeadline(cod('new'), settings)).toBe(at(24).getTime());
    expect(reservationDeadline(cod('confirmed'), settings)).toBeNull();
    // the prepaid deadline is unchanged: the setting, 48 h
    expect(reservationDeadline({ ...cod('new'), paymentMethod: 'cashplus' }, settings)).toBe(at(48).getTime());
  });

  it('expires at 24 hours and after, never before, never once confirmed', () => {
    const orders = [cod('new'), cod('confirmed')];
    expect(expiredUnpaidOrders(orders, settings, at(23)).map((o) => o.id)).toEqual([]);
    expect(expiredUnpaidOrders(orders, settings, at(24)).map((o) => o.id)).toEqual(['new']);
    expect(expiredUnpaidOrders(orders, settings, at(25)).map((o) => o.id)).toEqual(['new']);
    expect(expiredUnpaidOrders(orders, settings, at(24 * 30)).map((o) => o.id)).toEqual(['new']);
  });
});

describe('cash on delivery: the backup phone (owner, 2026-11-14)', () => {
  const rates = [{ id: 'oujda', active: true }] as never;
  const customer = (phoneAlt: string) => ({ fullName: 'Client Test', phone: '0612345678', phoneAlt, email: '', cityId: 'oujda', address: '12 rue Test', company: '', notes: '' });

  it('may be the first number, or another one; it is still required and checked', () => {
    expect(validateCustomer(customer('0612345678'), rates)).toEqual([]);
    expect(validateCustomer(customer('+212 6 12 34 56 78'), rates)).toEqual([]);
    expect(validateCustomer(customer('0712345678'), rates)).toEqual([]);
    expect(validateCustomer(customer(''), rates)).toEqual(['phone_alt']);
    expect(validateCustomer(customer('12345'), rates)).toEqual(['phone_alt']);
  });
});

describe('cash on delivery: the money, the owner\'s alone', () => {
  it('delivered -> collected by the carrier -> received by BOGA, in that order', () => {
    expect(canSetPayment(order('shipped', 'pending'), 'collected', 'owner')).toBe(false);
    expect(canSetPayment(order('delivered', 'pending'), 'paid', 'owner')).toBe(false);
    expect(canSetPayment(order('delivered', 'pending'), 'collected', 'owner')).toBe(true);
    expect(canSetPayment(order('delivered', 'collected'), 'paid', 'owner')).toBe(true);
    expect(canSetPayment(order('delivered', 'collected'), 'pending', 'owner')).toBe(true);
    expect(canSetPayment(order('delivered', 'collected'), 'refunded', 'owner')).toBe(false);
    expect(canSetPayment(order('delivered', 'paid'), 'refunded', 'owner')).toBe(true);
    expect(canSetPayment(order('delivered', 'pending'), 'awaiting_verification', 'owner')).toBe(false);
    expect(canSetPayment(order('returned', 'pending'), 'collected', 'owner')).toBe(false);
  });

  it('never by a manager or staff, and "collected" is never a prepaid state', () => {
    for (const role of ['manager', 'staff'] as const) {
      expect(canSetPayment(order('delivered', 'pending'), 'collected', role), role).toBe(false);
      expect(canSetPayment(order('delivered', 'collected'), 'paid', role), role).toBe(false);
    }
    expect(canSetPayment(order('delivered', 'paid', 'cashplus'), 'collected', 'owner')).toBe(false);
    expect(canSetPayment(order('new', 'pending', 'cashplus'), 'paid', 'owner')).toBe(true);
  });

  it('no payment report by the customer, no expiry, and the order page says "pay on delivery"', () => {
    expect(canReportPayment(order('new', 'pending'))).toBe(false);
    expect(canReportPayment(order('new', 'pending', 'cashplus'))).toBe(true);
    const old = { ...order('confirmed', 'pending'), createdAt: '2020-01-01T00:00:00Z' };
    const settings = { unpaidOrderTimeoutHours: 48, paymentCheckTimeoutHours: 120 };
    expect(reservationDeadline(old, settings)).toBeNull(); // confirmed: never (unconfirmed: below)
    expect(reservationDeadline({ ...old, paymentMethod: 'cashplus' }, settings)).not.toBeNull();
    expect(orderPhase(order('confirmed', 'pending'))).toBe('on_delivery');
    expect(orderPhase(order('confirmed', 'pending', 'cashplus'))).toBe('awaiting_payment');
    expect(orderPhase(order('delivery_failed', 'pending'))).toBe('delivery_failed');
  });

  it('the Payments page lists a delivered cod order until BOGA received the money', () => {
    expect(moneyToCheck(order('shipped', 'pending'))).toBe(false);
    expect(moneyToCheck(order('delivered', 'pending'))).toBe(true);
    expect(moneyToCheck(order('delivered', 'collected'))).toBe(true);
    expect(moneyToCheck(order('delivered', 'paid'))).toBe(false);
    expect(moneyToCheck(order('new', 'pending', 'cashplus'))).toBe(true);
  });
});

describe('the sales report', () => {
  const o = (id: string, status: OrderStatus, paymentStatus: PaymentStatus, total: number, extra: Partial<Order> = {}) =>
    ({ id, status, paymentStatus, total, paymentMethod: 'cod', createdAt: `2026-11-0${id}T10:00:00Z`, ...extra }) as Order;

  it('keeps delivery, the carrier\'s collection and BOGA\'s receipt apart, on the full amount paid by the customer', () => {
    const r = salesReport([
      o('1', 'delivered', 'pending', 300),
      o('2', 'delivered', 'collected', 200),
      o('3', 'delivered', 'paid', 150),
      o('4', 'delivered', 'refunded', 90),
      o('5', 'delivery_failed', 'pending', 80, { failureReason: 'Absent' }),
      o('6', 'returned', 'pending', 70, { failureReason: 'Refusé' }),
      o('7', 'confirmed', 'paid', 60, { paymentMethod: 'cashplus' }),
    ]);
    expect(r.sales).toEqual({ count: 3, amount: 650 });
    expect(r.toCollect).toEqual({ count: 1, amount: 300 });
    expect(r.atCarrier).toEqual({ count: 1, amount: 200 });
    expect(r.received).toEqual({ count: 2, amount: 210 });
    expect(r.byStatus).toMatchObject({ delivered: 4, delivery_failed: 1, returned: 1, confirmed: 1, new: 0 });
    expect(r.failed.map((x) => [x.id, x.failureReason])).toEqual([['6', 'Refusé'], ['5', 'Absent']]);
  });
});
