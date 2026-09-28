/**
 * Which status and payment changes an order may take, and who may make them.
 * The admin panel, the demo data layer and the database (set_order_status /
 * set_payment_status in supabase/migrations) apply these same rules.
 */
import type { Order, OrderStatus, PaymentStatus, Settings } from './types';

export type AdminRole = 'owner' | 'manager' | 'staff';

/** The one step forward from each status (cancelling is separate). */
export const NEXT_STATUS: Record<OrderStatus, OrderStatus | null> = {
  new: 'confirmed',
  confirmed: 'in_production',
  in_production: 'shipped',
  shipped: 'delivered',
  delivered: null,
  cancelled: null,
};

/** No payment on delivery: nothing is produced or shipped before the order is paid. */
const NEEDS_PAYMENT: OrderStatus[] = ['in_production', 'shipped', 'delivered'];

export type StatusRefusal = 'not_next' | 'needs_payment' | 'too_late_to_cancel' | 'closed';

export function statusChangeRefusal(order: Pick<Order, 'status' | 'paymentStatus'>, next: OrderStatus): StatusRefusal | null {
  if (order.status === 'cancelled' || order.status === 'delivered') return 'closed';
  if (next === 'cancelled') {
    // once roasting/packing started, the coffee cannot simply go back to stock
    return order.status === 'new' || order.status === 'confirmed' ? null : 'too_late_to_cancel';
  }
  if (NEXT_STATUS[order.status] !== next) return 'not_next';
  if (NEEDS_PAYMENT.includes(next) && order.paymentStatus !== 'paid') return 'needs_payment';
  return null;
}

const PAYMENT_FROM: Record<PaymentStatus, PaymentStatus[]> = {
  paid: ['pending', 'awaiting_verification', 'failed'],
  failed: ['pending', 'awaiting_verification'],
  refunded: ['paid'],
  pending: ['awaiting_verification', 'failed'],
  awaiting_verification: ['pending', 'failed'],
};

/** A refund closes the money side: only where the order cannot get stuck afterwards. */
const REFUNDABLE: OrderStatus[] = ['new', 'confirmed', 'cancelled', 'delivered'];

/**
 * Money is the owner's decision: only the owner records a payment, a failure or a refund.
 * - A refund happens before production (it also cancels the order, see
 *   refundCancelsOrder), after a cancellation, or after delivery — never
 *   mid-production, where it would leave the order unable to move.
 * - Money that arrives after the order was cancelled (e.g. a transfer after the
 *   automatic 48 h cancellation) is recorded as refunded: the stock went back,
 *   so the customer gets the money back or places a new order.
 */
export function canSetPayment(order: Pick<Order, 'paymentStatus' | 'status'>, next: PaymentStatus, role: AdminRole): boolean {
  if (role !== 'owner') return false;
  if (next === 'refunded') {
    if (!REFUNDABLE.includes(order.status)) return false;
    return order.paymentStatus === 'paid' || (order.status === 'cancelled' && order.paymentStatus !== 'refunded');
  }
  if (order.status === 'cancelled') return false;
  return PAYMENT_FROM[next].includes(order.paymentStatus);
}

/** The customer still has a payment to make: only then does the order page show the payment steps. */
export const awaitsPayment = (order: Pick<Order, 'status' | 'paymentStatus'>): boolean =>
  order.status !== 'cancelled' && (order.paymentStatus === 'pending' || order.paymentStatus === 'failed');

/** What the order page tells the customer about the order as a whole. */
export type OrderPhase = 'refunded' | 'cancelled' | 'delivered' | 'paid' | 'awaiting_payment';

export function orderPhase(order: Pick<Order, 'status' | 'paymentStatus'>): OrderPhase {
  if (order.paymentStatus === 'refunded') return 'refunded';
  if (order.status === 'cancelled') return 'cancelled';
  if (order.status === 'delivered') return 'delivered';
  return order.paymentStatus === 'paid' ? 'paid' : 'awaiting_payment';
}

/**
 * A refund before production ends the order: it is cancelled and its coffee
 * goes back to stock, so the customer is not asked to pay again and nothing
 * stays reserved. (Database: set_payment_status does the same.)
 */
export const refundCancelsOrder = (order: Pick<Order, 'status'>): boolean => order.status === 'new' || order.status === 'confirmed';

/**
 * Settings a manager may change. Everything else is the owner's: the contact
 * details customers send their orders to, who receives the notifications, the
 * bank details shown for transfers, and the business rules. (Database: the
 * guard_settings trigger applies the same list.)
 */
export const MANAGER_SETTINGS: readonly (keyof Settings)[] = ['freeShippingOver'];

/** Staff change no setting at all; managers only MANAGER_SETTINGS; the owner everything. */
export function settingsChangeRefused(before: Settings, after: Settings, role: AdminRole): boolean {
  if (role === 'owner') return false;
  const allowed: readonly (keyof Settings)[] = role === 'manager' ? MANAGER_SETTINGS : [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)] as (keyof Settings)[]);
  return [...keys].some((k) => !allowed.includes(k) && !sameValue(before[k], after[k]));
}

/** Same data, whatever the order of the keys. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
