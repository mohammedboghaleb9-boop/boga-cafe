/**
 * Shape checks of the JSON bodies the storefront sends. Only known fields are
 * kept, each text within its form's limit (TEXT_MAX); business rules (prices,
 * stock, cities…) come after, in src/core.
 */
import { isValidQty } from '@/core/cart';
import { TEXT_MAX } from '@/core/limits';
import type { CheckoutInput } from '@/core/order';
import type { ContactRequestInput, QuoteInput } from '@/core/requests';
import { PACK_SIZES, type BusinessType, type CartItem, type PackSize, type PaymentMethodId, type RecipeLine } from '@/core/types';

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isText = (v: unknown, max: number): v is string => typeof v === 'string' && [...v].length <= max;
const isSize = (v: unknown): v is PackSize => PACK_SIZES.includes(v as PackSize);

const PAYMENT_METHODS: PaymentMethodId[] = ['card', 'cashplus', 'bank_transfer'];
const BUSINESS_TYPES: BusinessType[] = ['cafe', 'hotel', 'restaurant', 'company', 'individual', 'other'];
/** An id (product, origin, city, cart line) is never longer. */
const ID_MAX = 100;

const CUSTOMER_FIELDS = {
  fullName: TEXT_MAX.name,
  phone: TEXT_MAX.phone,
  email: TEXT_MAX.email,
  cityId: ID_MAX,
  address: TEXT_MAX.address,
  company: TEXT_MAX.company,
  notes: TEXT_MAX.notes,
} as const;

const CONTACT_FIELDS = {
  company: TEXT_MAX.company,
  contactName: TEXT_MAX.name,
  phone: TEXT_MAX.phone,
  email: TEXT_MAX.email,
  cityId: ID_MAX,
  notes: TEXT_MAX.notes,
} as const;

/** Missing text fields count as empty; anything else than text, or longer than the form allows, refuses the body. */
function texts<K extends string>(source: Record<string, unknown>, fields: Record<K, number>): Record<K, string> | null {
  const out = {} as Record<K, string>;
  for (const field of Object.keys(fields) as K[]) {
    const value = source[field] ?? '';
    if (!isText(value, fields[field])) return null;
    out[field] = value;
  }
  return out;
}

function parseItem(v: unknown): CartItem | null {
  if (!isObject(v) || !isText(v.id, ID_MAX) || !isValidQty(v.qty)) return null;
  if (v.type === 'product') {
    if (!isText(v.productId, ID_MAX) || !isSize(v.size)) return null;
    return { id: v.id, type: 'product', productId: v.productId, size: v.size, qty: v.qty };
  }
  if (v.type === 'custom' && isObject(v.blend) && isSize(v.blend.size) && Array.isArray(v.blend.lines) && v.blend.lines.length <= 10) {
    const lines: RecipeLine[] = [];
    for (const l of v.blend.lines) {
      if (!isObject(l) || !isText(l.originId, ID_MAX) || !Number.isInteger(l.percent)) return null;
      lines.push({ originId: l.originId, percent: l.percent as number });
    }
    return { id: v.id, type: 'custom', blend: { lines, size: v.blend.size }, qty: v.qty };
  }
  return null;
}

/** 1 to 50 well-formed cart lines. */
function parseItems(v: unknown): CartItem[] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > 50) return null;
  const items = v.map(parseItem);
  return items.some((i) => !i) ? null : (items as CartItem[]);
}

function parseContact(raw: Record<string, unknown>): ContactRequestInput | null {
  const t = texts(raw, CONTACT_FIELDS);
  if (!t || !BUSINESS_TYPES.includes(raw.businessType as BusinessType)) return null;
  return { ...t, businessType: raw.businessType as BusinessType };
}

export function parseCheckoutInput(raw: unknown): CheckoutInput | null {
  if (!isObject(raw) || !isObject(raw.customer)) return null;
  const items = parseItems(raw.items);
  const customer = texts(raw.customer, CUSTOMER_FIELDS);
  if (!items || !customer || !PAYMENT_METHODS.includes(raw.paymentMethod as PaymentMethodId)) return null;
  const locale = raw.locale === 'ar' || raw.locale === 'en' ? raw.locale : 'fr';
  return { items, customer, paymentMethod: raw.paymentMethod as PaymentMethodId, locale };
}

export function parseQuoteInput(raw: unknown): QuoteInput | null {
  if (!isObject(raw)) return null;
  const c = parseContact(raw);
  const items = parseItems(raw.items);
  return c && items ? { ...c, items } : null;
}

/** Cloudflare Turnstile token sent with either form (absent while Turnstile is off). */
export const captchaToken = (raw: unknown): string => (isObject(raw) && isText(raw.captchaToken, 4096) ? raw.captchaToken : '');
