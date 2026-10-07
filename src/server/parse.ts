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
/**
 * NUL and a lone surrogate are valid in a JavaScript string but not in PostgreSQL
 * text/jsonb. Checked by code unit (no \u escapes: the bundle stays plain ASCII).
 */
function storable(v: string): boolean {
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i);
    if (c === 0) return false;
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = v.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      i++; // a valid pair (an emoji, for example)
    } else if (c >= 0xdc00 && c <= 0xdfff) return false;
  }
  return true;
}
const isText = (v: unknown, max: number): v is string => typeof v === 'string' && [...v].length <= max && storable(v);
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The order's idempotency key (slice 3b): one random uuid per submission, the same
 * when the customer sends it again. null when the body has none (a site from before
 * the key: the order still goes through); 'invalid' for anything else than a uuid.
 */
export function idempotencyKey(raw: unknown): string | null | 'invalid' {
  const v = isObject(raw) ? raw.idempotencyKey : undefined;
  if (v === undefined || v === null) return null;
  return typeof v === 'string' && UUID.test(v) ? v.toLowerCase() : 'invalid';
}

/** Cloudflare Turnstile token sent with either form (2048 characters at most, Cloudflare's limit); '' when there is none. */
export const captchaToken = (raw: unknown): string => (isObject(raw) && isText(raw.captchaToken, 2048) ? raw.captchaToken : '');
