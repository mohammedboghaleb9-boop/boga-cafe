/**
 * A cart above the B2B threshold becomes a request handled by the administration
 * (no stock is reserved). Same checks and same result in the browser and on the
 * server (Edge Function "storefront").
 */
import { summarizeCart, type Catalog } from './cart';
import { isEmail, normalizePhone } from './validation';
import type { BusinessType, CartItem, QuoteRequest, Settings, ShippingRate } from './types';

export interface ContactRequestInput {
  businessType: BusinessType;
  company: string;
  contactName: string;
  phone: string;
  email: string;
  cityId: string;
  notes: string;
}

export type QuoteInput = ContactRequestInput & { items: CartItem[] };

export type RequestError = 'name' | 'phone' | 'email' | 'city';

export function validateContact(input: ContactRequestInput, rates: ShippingRate[]): RequestError[] {
  const errors: RequestError[] = [];
  if (input.contactName.trim().length < 3) errors.push('name');
  if (!normalizePhone(input.phone)) errors.push('phone');
  if (input.email.trim() && !isEmail(input.email)) errors.push('email');
  if (!rates.some((r) => r.id === input.cityId)) errors.push('city');
  return errors;
}

/** The cart priced at the website prices, for reference: the team agrees the final price. */
export function buildQuoteRequest(
  input: QuoteInput,
  ctx: { catalog: Catalog; settings: Settings; shippingRates: ShippingRate[] },
  ids: { id: string; number: string; now: string },
): { ok: true; quote: QuoteRequest } | { ok: false; errors: RequestError[] } {
  const errors = validateContact(input, ctx.shippingRates);
  if (errors.length) return { ok: false, errors };
  const cart = summarizeCart(input.items, ctx.catalog, ctx.settings);
  return {
    ok: true,
    quote: {
      id: ids.id,
      number: ids.number,
      createdAt: ids.now,
      businessType: input.businessType,
      company: input.company.trim(),
      contactName: input.contactName.trim(),
      phone: normalizePhone(input.phone)!,
      email: input.email.trim(),
      cityId: input.cityId,
      lines: cart.lines.flatMap((l) => (l.line ? [l.line] : [])),
      weightKg: cart.weightKg,
      indicativeTotal: cart.subtotal,
      notes: input.notes.trim(),
      status: 'new',
      finalPrice: null,
      adminNotes: '',
    },
  };
}
