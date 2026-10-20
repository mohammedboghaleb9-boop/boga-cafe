/**
 * Browser backend of the `Api` contract (src/data/types.ts): every rule runs
 * here, on the visitor's own copy of the data (./store). Each function maps to
 * one server call of the Supabase backend — same inputs, same results.
 */
import {
  cleanPayee,
  contactOk,
  contentOk,
  MAX_FREE_SHIPPING,
  methodOk,
  payeeProblem,
  recipientsOk,
  rulesOk,
  shippingRateOk,
  trimmedContact,
  trimmedContent,
  trimmedMethod,
  trimmedOrigin,
  trimmedProduct,
  trimmedRate,
  trimmedRecipients,
  type BusinessRules,
  type Payee,
} from '@/core/config';
import { buildOrder, expiredUnpaidOrders, type CheckoutInput } from '@/core/order';
import { buildQuoteRequest, type QuoteInput } from '@/core/requests';
import { originPriceOk } from '@/core/pricing';
import { adjustOriginStock, applyStock, isLowStock } from '@/core/stock';
import type {
  Order,
  OrderStatus,
  Origin,
  PaymentMethodConfig,
  PaymentStatus,
  Product,
  QuoteRequest,
  Settings,
  ShippingRate,
  SiteContent,
  StockMovement,
  StockReason,
} from '@/core/types';
import { draftsToLogs, lowStockMessage, orderMessage, paymentReportMessage, quoteMessage } from '@/services/notifications';
import { deliver } from '@/services/notifications/deliver';
import { methodAvailable } from '@/services/payments';
import { checkoutContext, storefrontCheckoutContext, templateContext } from '../context';
import { newOriginId, newProductId, newReference, newShippingId, uid } from '../ids';
import type { DbState } from '../state';
import type { Api } from '../types';
import { db } from './store';
import { awaitsPayment, canReportPayment, canSetPayment, refundCancelsOrder, settingsChangeRefused, statusChangeRefusal, type AdminRole } from '@/core/orderFlow';

const latency = () => new Promise((r) => setTimeout(r, 350));
const now = () => new Date().toISOString();

/** A part of the settings, refused for a role that may not change it (core/orderFlow) or a value the database would refuse. */
function savePart(patch: Partial<Settings>, role: AdminRole, valid: boolean): boolean {
  const before = db.get().settings;
  const after = { ...before, ...patch };
  if (!valid || settingsChangeRefused(before, after, role)) return false;
  db.update((s) => ({ ...s, settings: after }));
  return true;
}

function withLowStockAlerts(before: Origin[], after: Origin[], s: DbState, at: string) {
  return after
    .filter((o) => isLowStock(o) && !isLowStock(before.find((b) => b.id === o.id) ?? o))
    .flatMap((o) => draftsToLogs('stock.low', lowStockMessage(o), s.settings, at, uid));
}

/** Gives a cancelled order's coffee back to stock, with its lines in the history. */
function giveStockBack(s: DbState, o: Order, at: string, note = ''): Partial<DbState> {
  return {
    origins: applyStock(s.origins, o.stockDeductions, 1),
    stockMovements: [
      ...o.stockDeductions.map((d) => ({
        id: uid(), at, originId: d.originId, deltaKg: d.kg, reason: 'order_cancelled' as const, ref: o.number, note,
      })),
      ...s.stockMovements,
    ],
  };
}

function patchOrder(id: string, patch: (o: Order, s: DbState) => Partial<Order>, extra?: (s: DbState, o: Order) => Partial<DbState>) {
  db.update((s) => {
    const order = s.orders.find((o) => o.id === id);
    if (!order) return s;
    const next = { ...order, ...patch(order, s) };
    return { ...s, ...extra?.(s, order), orders: s.orders.map((o) => (o.id === id ? next : o)) };
  });
}

export const demoApi: Api = {
  /* ───────── Storefront ───────── */

  async placeOrder(input: CheckoutInput) {
    await latency();
    const s = db.get();
    const at = now();
    const number = newReference('BC', (r) => s.orders.some((o) => o.number === r));
    // refused like any unknown method: a card order while no gateway is connected
    const result = buildOrder(input, storefrontCheckoutContext(s), { id: uid(), number, now: at });
    if (!result.ok) return result;
    const order = result.order;
    const message = orderMessage(order, templateContext(s));

    db.update((cur) => {
      const origins = applyStock(cur.origins, order.stockDeductions, -1);
      const movements: StockMovement[] = order.stockDeductions.map((d) => ({
        id: uid(), at, originId: d.originId, deltaKg: -d.kg, reason: 'order', ref: order.number, note: '',
      }));
      const logs = [
        ...draftsToLogs('order.created', message, cur.settings, at, uid),
        ...withLowStockAlerts(cur.origins, origins, cur, at),
      ];
      return {
        ...cur,
        origins,
        orders: [order, ...cur.orders],
        stockMovements: [...movements, ...cur.stockMovements],
        notifications: [...logs, ...cur.notifications],
      };
    });
    deliver('order.created', order.number, message);
    return { ok: true, order };
  },

  /** Card gateway answer (CMI callback in production). */
  async completeCardPayment(orderId: string, success: boolean) {
    await latency();
    const o = db.get().orders.find((x) => x.id === orderId);
    // only an open card order waiting for the gateway can be paid this way
    if (!o || o.paymentMethod !== 'card' || !awaitsPayment(o)) return;
    patchOrder(orderId, (cur) => ({
      paymentStatus: success ? 'paid' : 'failed',
      status: success && cur.status === 'new' ? 'confirmed' : cur.status,
      history: [...cur.history, { at: now(), label: success ? 'payment.paid' : 'payment.failed' }],
    }));
  },

  /** Customer says "I have paid" for Cash Plus / transfer and gives the receipt reference. */
  async reportOfflinePayment(orderId: string, paymentRef: string) {
    await latency();
    const o = db.get().orders.find((x) => x.id === orderId);
    // Cash Plus / transfer only, and never over a payment already confirmed (core/orderFlow)
    if (!o || !canReportPayment(o)) return false;
    const at = now();
    const reported: Order = {
      ...o,
      paymentStatus: 'awaiting_verification',
      paymentRef: paymentRef.trim().slice(0, 80),
      history: [...o.history, { at, label: 'payment.reported' }],
    };
    // the team is told like for a new order: admin log, and WhatsApp + Gmail once deployed
    const message = paymentReportMessage(reported, templateContext(db.get()));
    db.update((s) => ({
      ...s,
      orders: s.orders.map((x) => (x.id === orderId ? reported : x)),
      notifications: [...draftsToLogs('payment.reported', message, s.settings, at, uid), ...s.notifications],
    }));
    deliver('payment.reported', reported.number, message);
    return true;
  },

  /** Every order is already in this browser's store. */
  async loadOrder() {},

  /** Cart above the B2B threshold → request handled by the administration. */
  async requestQuote(input: QuoteInput) {
    await latency();
    const s = db.get();
    const at = now();
    const number = newReference('QR', (r) => s.quotes.some((q) => q.number === r));
    const result = buildQuoteRequest(input, checkoutContext(s), { id: uid(), number, now: at });
    if (!result.ok) return result;
    const quote = result.quote;
    const message = quoteMessage(quote, templateContext(s));
    db.update((cur) => ({
      ...cur,
      quotes: [quote, ...cur.quotes],
      notifications: [...draftsToLogs('quote.created', message, cur.settings, at, uid), ...cur.notifications],
    }));
    deliver('quote.created', quote.number, message);
    return { ok: true as const, quote, message };
  },

  /* ───────── Admin ───────── */

  /** Returns why the change is refused for this role (core/orderFlow), or null once done. */
  async setOrderStatus(orderId: string, status: OrderStatus, role: AdminRole) {
    const current = db.get().orders.find((o) => o.id === orderId);
    if (!current) return 'closed';
    const refusal = statusChangeRefusal(current, status, role);
    if (refusal) return refusal;
    const at = now();
    patchOrder(
      orderId,
      (o) => ({ status, history: [...o.history, { at, label: `status.${status}` }] }),
      // Cancelling gives the reserved coffee back to stock (only once).
      (s, o) => (status === 'cancelled' && o.status !== 'cancelled' ? giveStockBack(s, o, at) : {}),
    );
    return null;
  },

  /**
   * Cancels the orders not paid by their deadline and gives their coffee back to
   * stock (rule in core: reservationDeadline). Runs when the shop or the admin
   * opens (demo only; on the live database the expire-unpaid-orders job does it every 15 minutes).
   */
  async expireUnpaidOrders() {
    const s = db.get();
    const expired = new Set(expiredUnpaidOrders(s.orders, s.settings, new Date()).map((o) => o.id));
    if (!expired.size) return 0;
    const at = now();
    db.update((cur) => {
      const cancel = cur.orders.filter((o) => expired.has(o.id) && o.status !== 'cancelled');
      return {
        ...cur,
        orders: cur.orders.map((o) =>
          cancel.includes(o) ? { ...o, status: 'cancelled' as const, history: [...o.history, { at, label: 'status.expired' }] } : o,
        ),
        origins: applyStock(cur.origins, cancel.flatMap((o) => o.stockDeductions), 1),
        stockMovements: [
          ...cancel.flatMap((o) =>
            o.stockDeductions.map((d) => ({
              id: uid(), at, originId: d.originId, deltaKg: d.kg, reason: 'order_cancelled' as const, ref: o.number, note: 'auto',
            })),
          ),
          ...cur.stockMovements,
        ],
      };
    });
    return expired.size;
  },

  /** Only the owner records payments, and only in a sensible order (core/orderFlow). */
  async setPaymentStatus(orderId: string, paymentStatus: PaymentStatus, role: AdminRole) {
    const current = db.get().orders.find((o) => o.id === orderId);
    if (!current || !canSetPayment(current, paymentStatus, role)) return false;
    const at = now();
    const cancels = paymentStatus === 'refunded' && refundCancelsOrder(current);
    patchOrder(
      orderId,
      (o) => ({
        paymentStatus,
        status: cancels ? 'cancelled' : paymentStatus === 'paid' && o.status === 'new' ? 'confirmed' : o.status,
        history: [...o.history, { at, label: `payment.${paymentStatus}` }, ...(cancels ? [{ at, label: 'status.cancelled' }] : [])],
      }),
      (s, o) => (cancels ? giveStockBack(s, o, at) : {}),
    );
    return true;
  },

  /** New product: its id and address come from the name and never replace an existing product. */
  async createProduct(draft: Product) {
    const clean = trimmedProduct(draft);
    const slug = newProductId(clean.name.fr, db.get().products);
    const product = { ...clean, id: slug, slug };
    db.update((s) => ({ ...s, products: [...s.products, product] }));
    return product;
  },

  /** Changes an existing product (false if there is none with this id: use createProduct). */
  async saveProduct(draft: Product) {
    const product = trimmedProduct(draft);
    if (!db.get().products.some((p) => p.id === product.id)) return false;
    db.update((s) => ({ ...s, products: s.products.map((p) => (p.id === product.id ? product : p)) }));
    return true;
  },

  async deleteProduct(id: string) {
    db.update((s) => ({ ...s, products: s.products.filter((p) => p.id !== id) }));
  },

  /** New origin, hidden, at 0 kg (its first lot goes through adjustStock); never replaces an existing one. Its price may be empty. */
  async createOrigin(draft: Origin) {
    const clean = trimmedOrigin(draft);
    const origin = { ...clean, id: newOriginId(clean.name.fr, db.get().origins), stockKg: 0, active: false };
    if (!originPriceOk(origin)) return null;
    db.update((s) => ({ ...s, origins: [...s.origins, origin] }));
    return origin;
  },

  /** Saves origin details. Stock is changed only through `adjustStock` so every change is logged. */
  async saveOrigin(draft: Origin) {
    const origin = trimmedOrigin(draft);
    if (!originPriceOk(origin) || !db.get().origins.some((o) => o.id === origin.id)) return false;
    db.update((s) => ({ ...s, origins: s.origins.map((o) => (o.id === origin.id ? { ...origin, stockKg: o.stockKg } : o)) }));
    return true;
  },

  async adjustStock(originId: string, deltaKg: number, reason: StockReason, note: string) {
    const at = now();
    db.update((s) => {
      const { origins, appliedKg } = adjustOriginStock(s.origins, originId, deltaKg);
      return {
        ...s,
        origins,
        stockMovements: [{ id: uid(), at, originId, deltaKg: appliedKg, reason, ref: '', note }, ...s.stockMovements],
        notifications: [...withLowStockAlerts(s.origins, origins, s, at), ...s.notifications],
      };
    });
  },

  /** A new city, hidden until shown on purpose; its id comes from its French name and is never an existing one. */
  async createShippingRate(draft: ShippingRate, role: AdminRole) {
    const clean = trimmedRate(draft);
    if (role === 'staff' || !shippingRateOk(clean)) return null;
    const rate = { ...clean, id: newShippingId(clean.city.fr, db.get().shippingRates), active: false };
    db.update((s) => ({ ...s, shippingRates: [...s.shippingRates, rate] }));
    return rate;
  },

  async saveShippingRate(draft: ShippingRate, role: AdminRole) {
    const rate = trimmedRate(draft);
    if (role === 'staff' || !shippingRateOk(rate) || !db.get().shippingRates.some((r) => r.id === rate.id)) return false;
    db.update((s) => ({ ...s, shippingRates: s.shippingRates.map((r) => (r.id === rate.id ? rate : r)) }));
    return true;
  },

  async deleteShippingRate(id: string) {
    db.update((s) => ({ ...s, shippingRates: s.shippingRates.filter((r) => r.id !== id) }));
  },

  async savePaymentMethod(draft: PaymentMethodConfig, role: AdminRole) {
    const method = trimmedMethod(draft);
    if (role !== 'owner' || !methodOk(method, methodAvailable({ id: 'card', enabled: true }, db.get().settings)) || !db.get().paymentMethods.some((m) => m.id === method.id)) return false;
    db.update((s) => ({ ...s, paymentMethods: s.paymentMethods.map((m) => (m.id === method.id ? method : m)) }));
    return true;
  },

  async saveRules(rules: BusinessRules, role: AdminRole) {
    return savePart(rules, role, rulesOk(rules));
  },

  async setSalesOpen(open: boolean, role: AdminRole) {
    return savePart({ salesOpen: open }, role, typeof open === 'boolean');
  },

  async saveFreeShipping(amount: number, role: AdminRole) {
    return savePart({ freeShippingOver: amount }, role, Number.isFinite(amount) && amount >= 0 && amount <= MAX_FREE_SHIPPING);
  },

  async savePayee(payee: Payee, role: AdminRole) {
    const clean = cleanPayee(payee);
    return savePart(clean, role, payeeProblem(clean) === null);
  },

  async saveRecipients(draft: Settings['notifications'], role: AdminRole) {
    const recipients = trimmedRecipients(draft);
    return savePart({ notifications: recipients }, role, recipientsOk(recipients));
  },

  /** The texts, and the contact details when given (owner only): both saved, or neither. */
  async saveContent(draft: SiteContent, draftContact: Settings['contact'] | null, role: AdminRole) {
    const content = trimmedContent(draft);
    const contact = draftContact && trimmedContact(draftContact);
    if (role === 'staff' || !contentOk(content) || (contact && !contactOk(contact))) return false;
    if (contact && !savePart({ contact }, role, true)) return false;
    db.update((s) => ({ ...s, content }));
    return true;
  },

  async updateQuote(id: string, patch: Partial<QuoteRequest>) {
    db.update((s) => ({ ...s, quotes: s.quotes.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
  },

  async resetDemo() {
    db.reset();
  },
};
