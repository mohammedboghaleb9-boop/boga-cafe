/**
 * The Api contract on Supabase. Orders and B2B requests go through the
 * storefront Edge Function (prices and stock recomputed on the server, limits,
 * Turnstile); an order is read back by its link with get_order_public, and
 * "I have paid" is report_offline_payment. The team's messages are queued by
 * the database (notification_outbox), so nothing is sent from the browser.
 * Every other call says which slice brings it (P5 step 3, PROJECT_NOTES.md).
 */
import type { Order, QuoteRequest } from '@/core/types';
import { quoteMessage } from '@/services/notifications';
import { templateContext } from '../context';
import type { Api, PlaceOrderResult, QuoteResult } from '../types';
import type { Client } from './client';
import { cachedOrder, rememberOrder } from './orderCache';
import { publicOrderFromRow } from './rows';
import type { CatalogStore } from './store';
import { postStorefront, type StorefrontTarget } from './storefront';

const notYet = (what: string) => async (): Promise<never> => {
  throw new Error(`Supabase backend: ${what} is not wired yet.`);
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The customer's copy (phone, address) with the status the server has now. */
const withStatus = (known: Order, fresh: Order): Order => ({ ...known, paymentStatus: fresh.paymentStatus, status: fresh.status });

export interface SupabaseApiDeps {
  client: Client;
  store: CatalogStore;
  storefront: StorefrontTarget;
}

export function createSupabaseApi({ client, store, storefront }: SupabaseApiDeps): Api {
  const known = (id: string) => store.db.get().orders.find((o) => o.id === id) ?? cachedOrder(id);

  /** The order as anyone with its link may see it; null when there is none. Throws on a failed read. */
  async function readPublic(id: string): Promise<Order | null> {
    const { data, error } = await client.rpc('get_order_public', { p_order_id: id });
    if (error) throw error;
    const row = data?.[0];
    return row ? publicOrderFromRow(id, row) : null;
  }

  function keep(order: Order) {
    // only an order placed in this tab has the customer's details worth keeping for a reload
    if (order.customer.phone) rememberOrder(order);
    store.putOrder(order);
  }

  return {
    async placeOrder(input): Promise<PlaceOrderResult> {
      const r = await postStorefront<{ order: Order }>('order', input, 'order', storefront);
      if (!r.ok) return { ok: false, errors: r.errors as (PlaceOrderResult & { ok: false })['errors'] };
      keep(r.order);
      return { ok: true, order: r.order };
    },

    async requestQuote(input): Promise<QuoteResult> {
      const r = await postStorefront<{ quote: QuoteRequest }>('quote', input, 'quote', storefront);
      if (!r.ok) return { ok: false, errors: r.errors as (QuoteResult & { ok: false })['errors'] };
      // the team's copy is already queued by the database; this one is for the customer's own "send" step
      return { ok: true, quote: r.quote, message: quoteMessage(r.quote, templateContext(store.db.get())) };
    },

    async reportOfflinePayment(orderId, paymentRef) {
      const ref = paymentRef.trim().slice(0, 80);
      const { error } = await client.rpc('report_offline_payment', { p_order_id: orderId, p_ref: ref });
      if (error) {
        console.error('report_offline_payment:', error);
        return false;
      }
      // the function answers nothing: read the order again to show where it stands
      try {
        const fresh = await readPublic(orderId);
        const mine = known(orderId);
        if (fresh) keep(mine ? { ...withStatus(mine, fresh), paymentRef: fresh.paymentStatus === 'awaiting_verification' ? ref : mine.paymentRef } : fresh);
      } catch (e) {
        console.error('get_order_public:', e);
      }
      return true;
    },

    async loadOrder(orderId) {
      if (!UUID.test(orderId)) return; // not an order link: the page says "not found"
      const mine = known(orderId);
      if (mine) store.putOrder(mine);
      try {
        const fresh = await readPublic(orderId);
        if (fresh) keep(mine ? withStatus(mine, fresh) : fresh);
      } catch (e) {
        // the copy from this tab is still worth showing; with none, the page says the read failed
        if (!mine) throw e;
        console.error('get_order_public:', e);
      }
    },

    completeCardPayment: notYet('card payment (CMI, after launch)'),
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
}
