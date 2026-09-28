/**
 * Which status and payment changes an order may take, and who may make them.
 * The admin panel, the demo data layer and the database (set_order_status /
 * set_payment_status in supabase/migrations) apply these same rules.
 */
import type { Order, OrderStatus, PaymentStatus } from './types';

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

/** Money is the owner's decision: only the owner records a payment, a failure or a refund. */
export function canSetPayment(order: Pick<Order, 'paymentStatus' | 'status'>, next: PaymentStatus, role: AdminRole): boolean {
  if (role !== 'owner') return false;
  // a cancelled order can still be refunded, nothing else
  if (order.status === 'cancelled' && next !== 'refunded') return false;
  return PAYMENT_FROM[next].includes(order.paymentStatus);
}
