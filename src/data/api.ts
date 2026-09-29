/**
 * The only way pages change data. Each function maps to one server call in
 * production (Supabase RPC / Edge Function) — same inputs, same results.
 */
import { summarizeCart } from '@/core/cart';
import { buildOrder, expiredUnpaidOrders, type CheckoutError, type CheckoutInput } from '@/core/order';
import { isPrice } from '@/core/pricing';
import { adjustOriginStock, applyStock, isLowStock } from '@/core/stock';
import { normalizePhone, isEmail } from '@/core/validation';
import type {
  BusinessType,
  CartItem,
  Order,
  OrderStatus,
  Origin,
  PaymentMethodConfig,
  PaymentStatus,
  Product,
  QuoteRequest,
  SampleRequest,
  Settings,
  ShippingRate,
  SiteContent,
  StockMovement,
  StockReason,
} from '@/core/types';
import { draftsToLogs, lowStockMessage, orderMessage, paymentReportMessage, quoteMessage, sampleMessage } from '@/services/notifications';
import { deliver } from '@/services/notifications/deliver';
import { checkoutContext, storefrontCheckoutContext, templateContext } from './context';
import { newReference, uid, uniqueSlug } from './ids';
import type { DbState } from './state';
import { db } from './store';
import { awaitsPayment, canSetPayment, refundCancelsOrder, settingsChangeRefused, statusChangeRefusal, type AdminRole, type StatusRefusal } from '@/core/orderFlow';

const latency = () => new Promise((r) => setTimeout(r, 350));
const RESERVED_PRODUCT_IDS = ['new'];
const now = () => new Date().toISOString();

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

export interface ContactRequestInput {
  businessType: BusinessType;
  company: string;
  contactName: string;
  phone: string;
  email: string;
  cityId: string;
  notes: string;
}

export type RequestError = 'name' | 'phone' | 'email' | 'city' | 'product';

function validateContact(input: ContactRequestInput, s: DbState): RequestError[] {
  const errors: RequestError[] = [];
  if (input.contactName.trim().length < 3) errors.push('name');
  if (!normalizePhone(input.phone)) errors.push('phone');
  if (input.email.trim() && !isEmail(input.email)) errors.push('email');
  if (!s.shippingRates.some((r) => r.id === input.cityId)) errors.push('city');
  return errors;
}

export const api = {
  /* ───────── Storefront ───────── */

  async placeOrder(
    input: CheckoutInput,
  ): Promise<{ ok: true; order: Order } | { ok: false; errors: CheckoutError[] }> {
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
    // Cash Plus / transfer only, and never over a payment already confirmed
    if (!o || o.paymentMethod === 'card' || o.status === 'cancelled' || o.paymentStatus !== 'pending') return;
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
  },

  async requestSample(input: ContactRequestInput & { productId: string; estMonthlyKg: number }) {
    await latency();
    const s = db.get();
    const errors = validateContact(input, s);
    if (!s.products.some((p) => p.id === input.productId && p.kind === 'b2b' && p.active)) errors.push('product');
    if (errors.length) return { ok: false as const, errors };
    const at = now();
    const rate = s.shippingRates.find((r) => r.id === input.cityId);
    const sample: SampleRequest = {
      ...input,
      id: uid(),
      number: newReference('SR', (r) => s.samples.some((x) => x.number === r)),
      createdAt: at,
      phone: normalizePhone(input.phone)!,
      status: 'new',
      free: null,
      deliveryFee: rate?.baseFee ?? 0,
      adminNotes: '',
    };
    const message = sampleMessage(sample, templateContext(s));
    db.update((cur) => ({
      ...cur,
      samples: [sample, ...cur.samples],
      notifications: [...draftsToLogs('sample.created', message, cur.settings, at, uid), ...cur.notifications],
    }));
    deliver('sample.created', sample.number, message);
    return { ok: true as const, sample, message };
  },

  /** Cart above the B2B threshold → request handled by the administration. */
  async requestQuote(input: ContactRequestInput & { items: CartItem[] }) {
    await latency();
    const s = db.get();
    const errors = validateContact(input, s);
    if (errors.length) return { ok: false as const, errors };
    const cart = summarizeCart(input.items, checkoutContext(s).catalog, s.settings);
    const at = now();
    const quote: QuoteRequest = {
      id: uid(),
      number: newReference('QR', (r) => s.quotes.some((q) => q.number === r)),
      createdAt: at,
      businessType: input.businessType,
      company: input.company,
      contactName: input.contactName,
      phone: normalizePhone(input.phone)!,
      email: input.email,
      cityId: input.cityId,
      lines: cart.lines.flatMap((l) => (l.line ? [l.line] : [])),
      weightKg: cart.weightKg,
      indicativeTotal: cart.subtotal,
      notes: input.notes,
      status: 'new',
      finalPrice: null,
      adminNotes: '',
    };
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

  /** Returns why the change is refused (core/orderFlow), or null once done. */
  setOrderStatus(orderId: string, status: OrderStatus): StatusRefusal | null {
    const current = db.get().orders.find((o) => o.id === orderId);
    if (!current) return 'closed';
    const refusal = statusChangeRefusal(current, status);
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
   * Cancels the orders nobody paid in time and gives their coffee back to
   * stock (rule in core: expiredUnpaidOrders). Runs when the shop or the admin
   * opens; a scheduled job does it on the server in phase 2.
   */
  expireUnpaidOrders(): number {
    const s = db.get();
    const expired = new Set(expiredUnpaidOrders(s.orders, s.settings.unpaidOrderTimeoutHours, new Date()).map((o) => o.id));
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
  setPaymentStatus(orderId: string, paymentStatus: PaymentStatus, role: AdminRole): boolean {
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
  createProduct(draft: Product): Product {
    // "new" is the admin's address for the add-product form (/admin/products/new)
    const taken = (id: string) => RESERVED_PRODUCT_IDS.includes(id) || db.get().products.some((p) => p.id === id || p.slug === id);
    const slug = uniqueSlug(draft.name.fr, taken, 'produit');
    const product = { ...draft, id: slug, slug };
    db.update((s) => ({ ...s, products: [...s.products, product] }));
    return product;
  },

  /** Changes an existing product (false if there is none with this id: use createProduct). */
  saveProduct(product: Product): boolean {
    if (!db.get().products.some((p) => p.id === product.id)) return false;
    db.update((s) => ({ ...s, products: s.products.map((p) => (p.id === product.id ? product : p)) }));
    return true;
  },

  deleteProduct(id: string) {
    db.update((s) => ({ ...s, products: s.products.filter((p) => p.id !== id) }));
  },

  /** New origin at 0 kg (its first lot goes through adjustStock); never replaces an existing one. Null without a real price per kg. */
  createOrigin(draft: Origin): Origin | null {
    if (!isPrice(draft.pricePerKg)) return null;
    const taken = (id: string) => db.get().origins.some((o) => o.id === id);
    const origin = { ...draft, id: uniqueSlug(draft.name.fr, taken, 'origine'), stockKg: 0 };
    db.update((s) => ({ ...s, origins: [...s.origins, origin] }));
    return origin;
  },

  /** Saves origin details. Stock is changed only through `adjustStock` so every change is logged. */
  saveOrigin(origin: Origin): boolean {
    if (!isPrice(origin.pricePerKg) || !db.get().origins.some((o) => o.id === origin.id)) return false;
    db.update((s) => ({ ...s, origins: s.origins.map((o) => (o.id === origin.id ? { ...origin, stockKg: o.stockKg } : o)) }));
    return true;
  },

  adjustStock(originId: string, deltaKg: number, reason: StockReason, note: string) {
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

  saveShippingRate(rate: ShippingRate) {
    db.update((s) => ({
      ...s,
      shippingRates: s.shippingRates.some((r) => r.id === rate.id)
        ? s.shippingRates.map((r) => (r.id === rate.id ? rate : r))
        : [...s.shippingRates, rate],
    }));
  },

  deleteShippingRate(id: string) {
    db.update((s) => ({ ...s, shippingRates: s.shippingRates.filter((r) => r.id !== id) }));
  },

  savePaymentMethod(method: PaymentMethodConfig) {
    db.update((s) => ({ ...s, paymentMethods: s.paymentMethods.map((m) => (m.id === method.id ? method : m)) }));
  },

  /** Returns false when the role may not change these settings (core/orderFlow MANAGER_SETTINGS). */
  saveSettings(settings: Settings, role: AdminRole): boolean {
    if (settingsChangeRefused(db.get().settings, settings, role)) return false;
    db.update((s) => ({ ...s, settings }));
    return true;
  },

  saveContent(content: SiteContent) {
    db.update((s) => ({ ...s, content }));
  },

  updateSample(id: string, patch: Partial<SampleRequest>) {
    db.update((s) => ({ ...s, samples: s.samples.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
  },

  updateQuote(id: string, patch: Partial<QuoteRequest>) {
    db.update((s) => ({ ...s, quotes: s.quotes.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
  },

  resetDemo() {
    db.reset();
  },
};
