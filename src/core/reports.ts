/**
 * What the dashboard reports about sales and the money of cash on delivery orders.
 * Every amount is the order's total, what the customer pays: never net of the carrier's fee
 * (owner, 2026-11-10). Delivery, the carrier's collection and BOGA's receipt are three separate facts.
 */
import type { Order, OrderStatus } from './types';

interface Sum {
  count: number;
  amount: number;
}

export interface SalesReport {
  /** Delivered orders (a refunded one is no longer a sale). */
  sales: Sum;
  /** Cash on delivery: delivered, the carrier's collection not confirmed yet. */
  toCollect: Sum;
  /** Cash on delivery: the carrier holds the money. */
  atCarrier: Sum;
  /** BOGA received the money, whatever the method. */
  received: Sum;
  byStatus: Record<OrderStatus, number>;
  /** Failed deliveries and returns, newest order first (by when it was placed): the reason is on each order. */
  failed: Order[];
}

const sum = (orders: Order[]): Sum => ({ count: orders.length, amount: orders.reduce((s, o) => s + o.total, 0) });

export function salesReport(orders: Order[]): SalesReport {
  const byStatus: Record<OrderStatus, number> = {
    new: 0,
    confirmed: 0,
    in_production: 0,
    shipped: 0,
    delivered: 0,
    cancelled: 0,
    delivery_failed: 0,
    returned: 0,
  };
  for (const o of orders) byStatus[o.status] += 1;
  return {
    sales: sum(orders.filter((o) => o.status === 'delivered' && o.paymentStatus !== 'refunded')),
    toCollect: sum(orders.filter((o) => o.paymentMethod === 'cod' && o.status === 'delivered' && o.paymentStatus === 'pending')),
    atCarrier: sum(orders.filter((o) => o.paymentStatus === 'collected')),
    received: sum(orders.filter((o) => o.paymentStatus === 'paid')),
    byStatus,
    failed: orders
      .filter((o) => o.status === 'delivery_failed' || o.status === 'returned')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  };
}
