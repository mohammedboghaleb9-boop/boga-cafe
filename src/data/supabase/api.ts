/**
 * The Api contract on Supabase. Only what the catalog slice needs is wired;
 * every other call says which slice brings it (P5 step 3, PROJECT_NOTES.md).
 */
import type { Api } from '../types';

const notYet = (what: string) => async (): Promise<never> => {
  throw new Error(`Supabase backend: ${what} is not wired yet.`);
};

export const supabaseApi: Api = {
  placeOrder: notYet('placing an order (slice 3)'),
  completeCardPayment: notYet('card payment (CMI, after launch)'),
  reportOfflinePayment: notYet('reporting a payment (slice 3)'),
  requestQuote: notYet('B2B requests (slice 3)'),
  // pg_cron runs expire_unpaid_orders() every 15 minutes on the server
  expireUnpaidOrders: async () => 0,
  setOrderStatus: notYet('order status (slice 8)'),
  setPaymentStatus: notYet('payment status (slice 8)'),
  createProduct: notYet('products (slice 9)'),
  saveProduct: notYet('products (slice 9)'),
  deleteProduct: notYet('products (slice 9)'),
  createOrigin: notYet('origins (slice 9)'),
  saveOrigin: notYet('origins (slice 9)'),
  adjustStock: notYet('stock (slice 8)'),
  saveShippingRate: notYet('shipping (slice 10)'),
  deleteShippingRate: notYet('shipping (slice 10)'),
  savePaymentMethod: notYet('payment methods (slice 10)'),
  saveSettings: notYet('settings (slice 10)'),
  saveContent: notYet('content (slice 10)'),
  updateQuote: notYet('B2B requests (slice 8)'),
  resetDemo: notYet('resetting the demo (demo only)'),
};
