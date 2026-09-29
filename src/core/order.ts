import { summarizeCart, type Catalog } from './cart';
import { shippingFee } from './shipping';
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

export type CheckoutError =
  | 'empty_cart'
  | 'cart_problem'
  | 'b2b_required'
  | 'out_of_stock'
  | 'name'
  | 'phone'
  | 'email'
  | 'city'
  | 'address'
  | 'payment_method';

export function validateCustomer(c: CustomerInfo, rates: ShippingRate[]): CheckoutError[] {
  const errors: CheckoutError[] = [];
  if (charCount(c.fullName) < 3) errors.push('name');
  if (!normalizePhone(c.phone)) errors.push('phone');
  if (c.email.trim() && !isEmail(c.email)) errors.push('email');
  if (!rates.some((r) => r.id === c.cityId && r.active)) errors.push('city');
  if (charCount(c.address) < 6) errors.push('address');
  return errors;
}

/**
 * Builds an order from scratch: prices, weight, delivery and stock are recomputed
 * from the catalog — never trusted from the browser. The database checks every figure
 * again before saving (supabase check_order); tests/sql-parity.test.ts shows both agree.
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

/**
 * Orders to cancel because nobody paid in time (Admin → Settings "cancel
 * unpaid after … hours"): still "new", payment not received nor reported, and
 * older than the limit. Cancelling gives their coffee back to stock, so an
 * abandoned bank transfer cannot hold the stock forever. 0 hours = off.
 * The same rule runs on the server in phase 2 (scheduled job).
 */
export function expiredUnpaidOrders(orders: Order[], timeoutHours: number, now: Date): Order[] {
  if (!(timeoutHours > 0)) return [];
  const limit = now.getTime() - timeoutHours * 3_600_000;
  return orders.filter(
    (o) =>
      o.status === 'new' &&
      (o.paymentStatus === 'pending' || o.paymentStatus === 'failed') &&
      new Date(o.createdAt).getTime() < limit,
  );
}
