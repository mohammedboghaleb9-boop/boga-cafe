/**
 * The orders placed in this tab, kept for the tab (sessionStorage): a reload of
 * the order page still has the phone and address the server never sends back
 * (get_order_public), so the customer can still send the order to the team.
 */
import type { Order } from '@/core/types';

const KEY = 'boga.orders';
const KEEP = 10;

function readAll(): Order[] {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(KEY) ?? '[]');
    return Array.isArray(parsed) ? (parsed as Order[]) : [];
  } catch {
    return [];
  }
}

export function rememberOrder(order: Order) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify([order, ...readAll().filter((o) => o.id !== order.id)].slice(0, KEEP)));
  } catch {
    // private mode or storage full: the order page still works from memory, then from the server
  }
}

export const cachedOrder = (id: string): Order | undefined => readAll().find((o) => o.id === id);
