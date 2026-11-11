/**
 * Which status and payment changes an order may take, and who may make them.
 * The admin panel, the demo data layer and the database (set_order_status /
 * set_payment_status in supabase/migrations) apply these same rules.
 */
import type { Order, OrderStatus, PaymentMethodId, PaymentStatus, Settings } from './types';

export type AdminRole = 'owner' | 'manager' | 'staff';

/** The one step forward from each status (cancelling is separate). */
export const NEXT_STATUS: Record<OrderStatus, OrderStatus | null> = {
  new: 'confirmed',
  confirmed: 'in_production',
  in_production: 'shipped',
  shipped: 'delivered',
  delivered: null,
  cancelled: null,
  // a failed delivery is tried again; coming back is the other way out (statusChangeRefusal)
  delivery_failed: 'shipped',
  returned: null,
};

/** A prepaid order: nothing is produced or shipped before it is paid. Cash on delivery ('cod') is paid after. */
const NEEDS_PAYMENT: OrderStatus[] = ['in_production', 'shipped', 'delivered'];

export type StatusRefusal = 'not_next' | 'needs_payment' | 'too_late_to_cancel' | 'closed' | 'refund_instead' | 'owner_only' | 'reason_required';

export function statusChangeRefusal(
  order: Pick<Order, 'status' | 'paymentStatus' | 'paymentMethod'>,
  next: OrderStatus,
  role: AdminRole,
): StatusRefusal | null {
  if (order.status === 'cancelled' || order.status === 'delivered' || order.status === 'returned') return 'closed';
  if (next === 'cancelled') {
    // once roasting/packing started, the coffee cannot simply go back to stock
    if (order.status !== 'new' && order.status !== 'confirmed') return 'too_late_to_cancel';
    // money is the owner's: a paid order ends with a refund (which cancels it and
    // gives the coffee back), and one the customer says is paid waits for the
    // owner to check the account before anyone cancels it
    if (order.paymentStatus === 'paid') return 'refund_instead';
    if (order.paymentStatus === 'awaiting_verification' && role !== 'owner') return 'owner_only';
    return null;
  }
  // a failed delivery is recorded with its reason (deliveryFailureRefusal), never as a plain step
  if (next === 'delivery_failed') return 'reason_required';
  const allowed = order.status === 'delivery_failed' ? next === 'shipped' || next === 'returned' : NEXT_STATUS[order.status] === next;
  if (!allowed) return 'not_next';
  if (NEEDS_PAYMENT.includes(next) && order.paymentStatus !== 'paid' && order.paymentMethod !== 'cod') return 'needs_payment';
  return null;
}

/** The reason of a failed delivery as it is kept: one line, single spaces. */
export const tidyReason = (reason: string) => reason.replace(/\s+/g, ' ').trim();

/**
 * Only a shipped cash on delivery order can fail its delivery, and the reason is wanted (3 to 200 characters).
 * A prepaid order is BOGA's money already: its refund rules know nothing of a failed delivery.
 */
export type DeliveryFailureRefusal = 'not_next' | 'invalid_reason';

export function deliveryFailureRefusal(order: Pick<Order, 'status' | 'paymentMethod'>, reason: string): DeliveryFailureRefusal | null {
  if (order.status !== 'shipped' || order.paymentMethod !== 'cod') return 'not_next';
  const length = [...tidyReason(reason)].length;
  return length < 3 || length > 200 ? 'invalid_reason' : null;
}

const PAYMENT_FROM: Record<PaymentStatus, PaymentStatus[]> = {
  paid: ['pending', 'awaiting_verification', 'failed'],
  failed: ['pending', 'awaiting_verification'],
  refunded: ['paid'],
  pending: ['awaiting_verification', 'failed'],
  awaiting_verification: ['pending', 'failed'],
  // cash on delivery only (COD_PAYMENT_FROM)
  collected: [],
};

/**
 * Cash on delivery: the money comes after the delivery, in two separate facts the owner records:
 * 'collected' (the carrier holds it) then 'paid' (BOGA received it, checked). 'collected' can be
 * taken back (a wrong click); only money BOGA received is refunded.
 */
const COD_PAYMENT_FROM: Partial<Record<PaymentStatus, PaymentStatus[]>> = {
  collected: ['pending'],
  paid: ['collected'],
  pending: ['collected'],
  refunded: ['paid'],
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
export function canSetPayment(order: Pick<Order, 'paymentStatus' | 'status' | 'paymentMethod'>, next: PaymentStatus, role: AdminRole): boolean {
  if (role !== 'owner') return false;
  if (order.paymentMethod === 'cod') {
    // nothing is collected before the order is delivered
    if (next === 'collected' && order.status !== 'delivered') return false;
    return (COD_PAYMENT_FROM[next] ?? []).includes(order.paymentStatus);
  }
  if (next === 'refunded') {
    if (!REFUNDABLE.includes(order.status)) return false;
    return order.paymentStatus === 'paid' || (order.status === 'cancelled' && order.paymentStatus !== 'refunded');
  }
  if (order.status === 'cancelled') return false;
  return PAYMENT_FROM[next].includes(order.paymentStatus);
}

/**
 * Transfer and Cash Plus tell the customer where to send the money: until the
 * owner has entered the real details (Admin → Payments), the method is not
 * offered and the database refuses orders with it (check_order). Nothing is
 * filled in for them: no example account a customer could pay into by mistake.
 */
export function payeeReady(id: PaymentMethodId, settings: Pick<Settings, 'bank' | 'cashplus'>): boolean {
  const filled = (v: string | undefined) => typeof v === 'string' && v.trim() !== '';
  if (id === 'bank_transfer') return filled(settings.bank?.holder) && filled(settings.bank?.bankName) && filled(settings.bank?.rib);
  if (id === 'cashplus') return filled(settings.cashplus?.beneficiary) && filled(settings.cashplus?.city) && filled(settings.cashplus?.phone);
  return true;
}

/**
 * The customer says they paid by transfer or Cash Plus and gives the reference:
 * while the order waits for its payment, or again after the owner found nothing
 * (failed). It only asks the owner to check: it never marks anything paid, and the
 * order keeps the deadline counted from when it was placed (reservationDeadline).
 */
export const canReportPayment = (order: Pick<Order, 'status' | 'paymentStatus' | 'paymentMethod'>): boolean =>
  order.paymentMethod !== 'card' &&
  // cash on delivery: the customer pays the carrier, there is nothing to report
  order.paymentMethod !== 'cod' &&
  (order.status === 'new' || order.status === 'confirmed') &&
  (order.paymentStatus === 'pending' || order.paymentStatus === 'failed');

/**
 * Money that waits for the owner (Admin → Payments): a prepaid order reported or still unpaid, or a
 * cash on delivery order delivered and not yet received by BOGA.
 */
export const moneyToCheck = (order: Pick<Order, 'status' | 'paymentStatus' | 'paymentMethod'>): boolean => {
  if (order.status === 'cancelled') return false;
  if (order.paymentMethod === 'cod') return (order.status === 'delivered' && order.paymentStatus === 'pending') || order.paymentStatus === 'collected';
  return order.paymentStatus === 'awaiting_verification' || (order.paymentStatus === 'pending' && order.paymentMethod !== 'card');
};

/** The customer still has a payment to make: only then does the order page show the payment steps. */
export const awaitsPayment = (order: Pick<Order, 'status' | 'paymentStatus'>): boolean =>
  order.status !== 'cancelled' && (order.paymentStatus === 'pending' || order.paymentStatus === 'failed');

/** What the order page tells the customer about the order as a whole. */
type OrderPhase = 'refunded' | 'cancelled' | 'returned' | 'delivery_failed' | 'delivered' | 'paid' | 'on_delivery' | 'awaiting_payment';

export function orderPhase(order: Pick<Order, 'status' | 'paymentStatus' | 'paymentMethod'>): OrderPhase {
  if (order.paymentStatus === 'refunded') return 'refunded';
  if (order.status === 'cancelled') return 'cancelled';
  if (order.status === 'returned') return 'returned';
  if (order.status === 'delivery_failed') return 'delivery_failed';
  if (order.status === 'delivered') return 'delivered';
  if (order.paymentStatus === 'paid') return 'paid';
  // cash on delivery: nothing to pay before the carrier comes
  return order.paymentMethod === 'cod' ? 'on_delivery' : 'awaiting_payment';
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
