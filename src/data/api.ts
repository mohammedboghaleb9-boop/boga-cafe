/**
 * The only way pages change data. Each function maps to one server call in
 * production (Supabase RPC / Edge Function) — same inputs, same results.
 */
import { summarizeCart } from '@/core/cart';
import { buildOrder, type CheckoutError, type CheckoutInput } from '@/core/order';
import { applyStock, isLowStock } from '@/core/stock';
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
import { draftsToLogs, lowStockMessage, orderMessage, quoteMessage, sampleMessage } from '@/services/notifications';
import { checkoutContext, templateContext } from './context';
import { reference, uid } from './ids';
import type { DbState } from './state';
import { db } from './store';

const latency = () => new Promise((r) => setTimeout(r, 350));
const now = () => new Date().toISOString();

function withLowStockAlerts(before: Origin[], after: Origin[], s: DbState, at: string) {
  return after
    .filter((o) => isLowStock(o) && !isLowStock(before.find((b) => b.id === o.id) ?? o))
    .flatMap((o) => draftsToLogs('stock.low', lowStockMessage(o), s.settings, at, uid));
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

  async placeOrder(input: CheckoutInput): Promise<{ ok: true; order: Order } | { ok: false; errors: CheckoutError[] }> {
    await latency();
    const s = db.get();
    const at = now();
    const number = reference('BC', s.counters.order + 1);
    const result = buildOrder(input, checkoutContext(s), { id: uid(), number, now: at });
    if (!result.ok) return result;
    const order = result.order;

    db.update((cur) => {
      const origins = applyStock(cur.origins, order.stockDeductions, -1);
      const movements: StockMovement[] = order.stockDeductions.map((d) => ({
        id: uid(), at, originId: d.originId, deltaKg: -d.kg, reason: 'order', ref: order.number, note: '',
      }));
      const logs = [
        ...draftsToLogs('order.created', orderMessage(order, templateContext(cur)), cur.settings, at, uid),
        ...withLowStockAlerts(cur.origins, origins, cur, at),
      ];
      return {
        ...cur,
        origins,
        orders: [order, ...cur.orders],
        stockMovements: [...movements, ...cur.stockMovements],
        notifications: [...logs, ...cur.notifications],
        counters: { ...cur.counters, order: cur.counters.order + 1 },
      };
    });
    return { ok: true, order };
  },

  /** Card gateway answer (CMI callback in production). */
  async completeCardPayment(orderId: string, success: boolean) {
    await latency();
    patchOrder(orderId, (o) => ({
      paymentStatus: success ? 'paid' : 'failed',
      status: success && o.status === 'new' ? 'confirmed' : o.status,
      history: [...o.history, { at: now(), label: success ? 'payment.paid' : 'payment.failed' }],
    }));
  },

  /** Customer says "I have paid" for Cash Plus / transfer and gives the receipt reference. */
  async reportOfflinePayment(orderId: string, paymentRef: string) {
    await latency();
    patchOrder(orderId, (o) => ({
      paymentStatus: 'awaiting_verification',
      paymentRef,
      history: [...o.history, { at: now(), label: 'payment.reported' }],
    }));
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
      number: reference('SR', s.counters.sample + 1),
      createdAt: at,
      phone: normalizePhone(input.phone)!,
      status: 'new',
      free: null,
      deliveryFee: rate?.baseFee ?? 0,
      adminNotes: '',
    };
    db.update((cur) => ({
      ...cur,
      samples: [sample, ...cur.samples],
      notifications: [...draftsToLogs('sample.created', sampleMessage(sample, templateContext(cur)), cur.settings, at, uid), ...cur.notifications],
      counters: { ...cur.counters, sample: cur.counters.sample + 1 },
    }));
    return { ok: true as const, sample };
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
      number: reference('QR', s.counters.quote + 1),
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
    db.update((cur) => ({
      ...cur,
      quotes: [quote, ...cur.quotes],
      notifications: [...draftsToLogs('quote.created', quoteMessage(quote, templateContext(cur)), cur.settings, at, uid), ...cur.notifications],
      counters: { ...cur.counters, quote: cur.counters.quote + 1 },
    }));
    return { ok: true as const, quote };
  },

  /* ───────── Admin ───────── */

  setOrderStatus(orderId: string, status: OrderStatus) {
    const at = now();
    patchOrder(
      orderId,
      (o) => ({ status, history: [...o.history, { at, label: `status.${status}` }] }),
      (s, o) => {
        // Cancelling gives the reserved coffee back to stock (only once).
        if (status !== 'cancelled' || o.status === 'cancelled') return {};
        return {
          origins: applyStock(s.origins, o.stockDeductions, 1),
          stockMovements: [
            ...o.stockDeductions.map((d) => ({
              id: uid(), at, originId: d.originId, deltaKg: d.kg, reason: 'order_cancelled' as const, ref: o.number, note: '',
            })),
            ...s.stockMovements,
          ],
        };
      },
    );
  },

  setPaymentStatus(orderId: string, paymentStatus: PaymentStatus) {
    patchOrder(orderId, (o) => ({
      paymentStatus,
      status: paymentStatus === 'paid' && o.status === 'new' ? 'confirmed' : o.status,
      history: [...o.history, { at: now(), label: `payment.${paymentStatus}` }],
    }));
  },

  saveProduct(product: Product) {
    db.update((s) => ({
      ...s,
      products: s.products.some((p) => p.id === product.id)
        ? s.products.map((p) => (p.id === product.id ? product : p))
        : [...s.products, product],
    }));
  },

  deleteProduct(id: string) {
    db.update((s) => ({ ...s, products: s.products.filter((p) => p.id !== id) }));
  },

  /** Saves origin details. Stock is changed only through `adjustStock` so every change is logged. */
  saveOrigin(origin: Origin) {
    db.update((s) => {
      const existing = s.origins.find((o) => o.id === origin.id);
      return existing
        ? { ...s, origins: s.origins.map((o) => (o.id === origin.id ? { ...origin, stockKg: o.stockKg } : o)) }
        : { ...s, origins: [...s.origins, { ...origin, stockKg: 0 }] };
    });
  },

  adjustStock(originId: string, deltaKg: number, reason: StockReason, note: string) {
    const at = now();
    db.update((s) => {
      const origins = applyStock(s.origins, [{ originId, kg: deltaKg }], 1).map((o) =>
        o.id === originId && o.stockKg < 0 ? { ...o, stockKg: 0 } : o,
      );
      return {
        ...s,
        origins,
        stockMovements: [{ id: uid(), at, originId, deltaKg, reason, ref: '', note }, ...s.stockMovements],
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

  saveSettings(settings: Settings) {
    db.update((s) => ({ ...s, settings }));
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
