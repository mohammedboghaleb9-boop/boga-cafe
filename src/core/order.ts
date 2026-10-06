import { summarizeCart, type Catalog } from './cart';
import { shippingFee } from './shipping';
import { TEXT_MAX } from './limits';
import { charCount, isEmail, normalizePhone } from './validation';
import type {
  CartItem,
  CustomerInfo,
  Locale,
  Order,
  PaymentMethodConfig,
  PaymentMethodId,
  Settings,
  ShippingRate,
} from './types';

export interface CheckoutInput {
  items: CartItem[];
  customer: CustomerInfo;
  paymentMethod: PaymentMethodId;
  locale: Locale;
}

export interface CheckoutContext {
  catalog: Catalog;
  settings: Settings;
  shippingRates: ShippingRate[];
  paymentMethods: PaymentMethodConfig[];
}

/** Every reason an order can be refused (the site reads the server's answers against this list). */
export const CHECKOUT_ERRORS = [
  'empty_cart',
  'cart_problem',
  'b2b_required',
  'out_of_stock',
  'name',
  'phone',
  'email',
  'city',
  'address',
  'payment_method',
] as const;
export type CheckoutError = (typeof CHECKOUT_ERRORS)[number];

export function validateCustomer(c: CustomerInfo, rates: ShippingRate[]): CheckoutError[] {
  const errors: CheckoutError[] = [];
  // the upper limits are the form's and the database's (TEXT_MAX)
  const name = charCount(c.fullName);
  const address = charCount(c.address);
  if (name < 3 || name > TEXT_MAX.name) errors.push('name');
  if (!normalizePhone(c.phone)) errors.push('phone');
  if ((c.email.trim() && !isEmail(c.email)) || charCount(c.email) > TEXT_MAX.email) errors.push('email');
  if (!rates.some((r) => r.id === c.cityId && r.active)) errors.push('city');
  if (address < 6 || address > TEXT_MAX.address) errors.push('address');
  return errors;
}

/**
 * Builds an order from scratch: prices, weight, delivery and stock are recomputed
 * from the catalog — never trusted from the browser. The database checks every figure
 * again before saving (supabase check_order); tests/sql-parity.test.ts checks both agree on a sample of carts.
 */
export function buildOrder(
  input: CheckoutInput,
  ctx: CheckoutContext,
  ids: { id: string; number: string; now: string },
): { ok: true; order: Order } | { ok: false; errors: CheckoutError[] } {
  const errors: CheckoutError[] = [];
  if (input.items.length === 0) return { ok: false, errors: ['empty_cart'] };

  const cart = summarizeCart(input.items, ctx.catalog, ctx.settings);
  if (cart.lines.some((l) => l.problem)) errors.push('cart_problem');
  if (cart.isB2B) errors.push('b2b_required');
  if (cart.shortages.length > 0) errors.push('out_of_stock');

  errors.push(...validateCustomer(input.customer, ctx.shippingRates));
  const method = ctx.paymentMethods.find((m) => m.id === input.paymentMethod && m.enabled);
  if (!method) errors.push('payment_method');

  if (errors.length > 0) return { ok: false, errors };

  const rate = ctx.shippingRates.find((r) => r.id === input.customer.cityId)!;
  const fee = shippingFee(rate, cart.weightKg, cart.subtotal, ctx.settings);
  const lines = cart.lines.map((l) => l.line!);

  return {
    ok: true,
    order: {
      id: ids.id,
      number: ids.number,
      createdAt: ids.now,
      locale: input.locale,
      customer: {
        ...input.customer,
        phone: normalizePhone(input.customer.phone)!,
        fullName: input.customer.fullName.trim(),
        email: input.customer.email.trim(),
        address: input.customer.address.trim(),
      },
      lines,
      weightKg: cart.weightKg,
      subtotal: cart.subtotal,
      shippingFee: fee,
      total: cart.subtotal + fee,
      paymentMethod: input.paymentMethod,
      paymentStatus: 'pending',
      status: 'new',
      stockDeductions: cart.requirements,
      history: [{ at: ids.now, label: 'order.created' }],
    },
  };
}

/** Used when a setting is missing or not a real limit: a reservation never lasts forever. */
export const DEFAULT_UNPAID_TIMEOUT_HOURS = 48;
export const DEFAULT_PAYMENT_CHECK_TIMEOUT_HOURS = 120;

const limitHours = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 1 ? value : fallback;

/**
 * Stock life of an order (database: commit_order, set_order_status, expire_unpaid_orders):
 * - placed: its coffee is taken from stock at once (reserved), so two customers
 *   never buy the same last kilo;
 * - reserved while new or confirmed and not paid. "I have paid" is only the
 *   customer's word: it gives the owner time to check the account, not more;
 * - committed once the owner has recorded the money (paid): only then can it go
 *   into production, after which it is never given back;
 * - given back when it is cancelled, refunded before production, or not paid by
 *   this deadline (hours after it was placed, so reporting a payment late or
 *   again never extends it). Null: nothing reserved can expire.
 */
export function reservationDeadline(
  order: Pick<Order, 'status' | 'paymentStatus' | 'createdAt'>,
  settings: Pick<Settings, 'unpaidOrderTimeoutHours' | 'paymentCheckTimeoutHours'>,
): number | null {
  if (order.status !== 'new' && order.status !== 'confirmed') return null;
  if (order.paymentStatus !== 'pending' && order.paymentStatus !== 'failed' && order.paymentStatus !== 'awaiting_verification') return null;
  const unpaid = limitHours(settings.unpaidOrderTimeoutHours, DEFAULT_UNPAID_TIMEOUT_HOURS);
  const hours =
    order.paymentStatus === 'awaiting_verification'
      ? Math.max(unpaid, limitHours(settings.paymentCheckTimeoutHours, DEFAULT_PAYMENT_CHECK_TIMEOUT_HOURS))
      : unpaid;
  return new Date(order.createdAt).getTime() + hours * 3_600_000;
}

/** Orders past their deadline: cancelled, their coffee back in stock (a scheduled job on the server). */
export function expiredUnpaidOrders(
  orders: Order[],
  settings: Pick<Settings, 'unpaidOrderTimeoutHours' | 'paymentCheckTimeoutHours'>,
  now: Date,
): Order[] {
  return orders.filter((o) => {
    const deadline = reservationDeadline(o, settings);
    return deadline !== null && deadline < now.getTime();
  });
}
