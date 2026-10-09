/**
 * Database rows → the types of src/core. Pure functions, shared by the site and
 * the Edge Functions (src/server).
 */
import {
  PACK_SIZES,
  type BusinessType,
  type Locale,
  type Localized,
  type NotificationChannel,
  type NotificationEvent,
  type NotificationLog,
  type Order,
  type OrderLine,
  type OrderStatus,
  type Origin,
  type PackSize,
  type PaymentMethodConfig,
  type PaymentMethodId,
  type PaymentStatus,
  type Product,
  type QuoteRequest,
  type QuoteStatus,
  type Settings,
  type ShippingRate,
  type SiteContent,
  type StockDeduction,
  type StockMovement,
  type StockReason,
} from '@/core/types';
import type { FunctionReturns, Json, Tables } from './database.types';

export type ProductRow = Tables<'products'> & {
  product_recipes: Pick<Tables<'product_recipes'>, 'origin_id' | 'percent'>[];
};

const loc = (j: Json): Localized => ({ ar: '', fr: '', en: '', ...(j as Partial<Localized>) });

export const originFromRow = (r: Tables<'origins'>): Origin => ({
  id: r.id,
  name: loc(r.name),
  countryCode: r.country_code,
  species: r.species as Origin['species'],
  region: r.region,
  roastLevel: r.roast_level as Origin['roastLevel'],
  tastingNotes: loc(r.tasting_notes),
  // numeric columns arrive as numbers or, past JavaScript's precision, as text
  stockKg: Number(r.stock_kg),
  lowStockKg: Number(r.low_stock_kg),
  pricePerKg: Number(r.price_per_kg),
  customBlendEnabled: r.custom_blend_enabled,
  restockDate: r.restock_date ?? undefined,
  active: r.active,
  updatedAt: r.updated_at,
});

/** The database keeps no display order for origins: Arabica first, then by name. */
export const byOriginOrder = (a: Origin, b: Origin) =>
  a.species.localeCompare(b.species) || a.name.fr.localeCompare(b.name.fr, 'fr');

function pricesFromJson(j: Json): Product['prices'] {
  const raw = (j ?? {}) as Record<string, unknown>;
  const prices: Product['prices'] = {};
  for (const size of PACK_SIZES) {
    const v = raw[String(size)];
    if (typeof v === 'number') prices[size as PackSize] = v;
  }
  return prices;
}

export const productFromRow = (r: ProductRow): Product => ({
  id: r.id,
  slug: r.slug,
  kind: r.kind as Product['kind'],
  name: loc(r.name),
  tagline: loc(r.tagline),
  description: loc(r.description),
  // biggest share first (the database keeps no line order)
  recipe: r.product_recipes
    .map((x) => ({ originId: x.origin_id, percent: x.percent }))
    .sort((a, b) => b.percent - a.percent || a.originId.localeCompare(b.originId)),
  roastLevel: r.roast_level as Product['roastLevel'],
  tastingNotes: loc(r.tasting_notes),
  prices: pricesFromJson(r.prices),
  image: r.image_url ?? undefined,
  featured: r.featured,
  active: r.active,
  sortOrder: r.sort_order,
  updatedAt: r.updated_at,
});

export const shippingRateFromRow = (r: Tables<'shipping_rates'>): ShippingRate => ({
  id: r.id,
  city: loc(r.city),
  distanceKm: r.distance_km,
  baseFee: Number(r.base_fee),
  includedKg: Number(r.included_kg),
  extraPerKg: Number(r.extra_per_kg),
  deliveryDays: r.delivery_days,
  active: r.active,
});

const PAYMENT_ORDER: PaymentMethodId[] = ['card', 'cashplus', 'bank_transfer'];
export const byPaymentOrder = (a: PaymentMethodConfig, b: PaymentMethodConfig) =>
  PAYMENT_ORDER.indexOf(a.id) - PAYMENT_ORDER.indexOf(b.id);

export const paymentMethodFromRow = (r: Tables<'payment_methods'>): PaymentMethodConfig => ({
  id: r.id as PaymentMethodId,
  enabled: r.enabled,
  label: loc(r.label),
  instructions: loc(r.instructions),
});

/** Notification recipients are owner-only (admin_config): unknown to whoever cannot read them. */
const NO_RECIPIENTS: Settings['notifications'] = {
  adminWhatsapp: '',
  adminEmail: '',
  whatsappEnabled: false,
  emailEnabled: false,
};

/**
 * Stored values over the code defaults, one level deep, so a setting added in
 * the code later works before anyone saves it from the Admin Panel.
 */
export function settingsFromRows(site: Json | undefined, admin: Tables<'admin_config'> | null, defaults: Settings): Settings {
  const stored = (site ?? {}) as Partial<Settings>;
  return {
    ...defaults,
    ...stored,
    customBlend: {
      ...defaults.customBlend,
      ...stored.customBlend,
      feeBySize: { ...defaults.customBlend.feeBySize, ...stored.customBlend?.feeBySize },
    },
    contact: { ...defaults.contact, ...stored.contact },
    bank: { ...defaults.bank, ...stored.bank },
    cashplus: { ...defaults.cashplus, ...stored.cashplus },
    notifications: admin
      ? {
          adminWhatsapp: admin.admin_whatsapp,
          adminEmail: admin.admin_email,
          whatsappEnabled: admin.whatsapp_on,
          emailEnabled: admin.email_on,
        }
      : NO_RECIPIENTS,
  };
}

export const contentFromRow = (j: Json | undefined, defaults: SiteContent): SiteContent => ({
  ...defaults,
  ...((j ?? {}) as Partial<SiteContent>),
});

export type PublicOrderRow = FunctionReturns<'get_order_public'>[number];

/** What both readings share: numbers come back from PostgreSQL numeric as text or number. */
const orderFigures = (r: PublicOrderRow) => ({
  number: r.number,
  createdAt: r.created_at,
  lines: r.lines as unknown as OrderLine[],
  weightKg: Number(r.weight_kg),
  subtotal: Number(r.subtotal),
  shippingFee: Number(r.shipping_fee),
  total: Number(r.total),
  paymentMethod: r.payment_method as PaymentMethodId,
  paymentStatus: r.payment_status as PaymentStatus,
  status: r.status as OrderStatus,
  history: [],
});

/**
 * An order read back by its link (get_order_public): what the customer may see
 * again from any device. The phone, email, address and notes are not returned,
 * on purpose, so they stay empty here and the page shows no message to send.
 */
export const publicOrderFromRow = (id: string, r: PublicOrderRow): Order => ({
  ...orderFigures(r),
  id,
  // not returned; the order page does not use it
  locale: 'fr',
  customer: { fullName: r.customer_name, phone: '', email: '', cityId: r.city_id, address: '', company: '', notes: '' },
  stockDeductions: [],
});

export type OrderEventRow = Pick<Tables<'order_events'>, 'at' | 'label'>;

/**
 * A whole order row, as the server reads it with its secret key (the storefront
 * function gives a repeated submission its saved order) or an admin reads it
 * with its events (oldest first, as the order page lists them).
 */
export const orderFromRow = (r: Tables<'orders'>, events: OrderEventRow[] = []): Order => ({
  ...orderFigures(r),
  id: r.id,
  locale: r.locale as Locale,
  customer: { fullName: r.customer_name, phone: r.phone, email: r.email, cityId: r.city_id, address: r.address, company: r.company, notes: r.notes },
  paymentRef: r.payment_ref ?? undefined,
  stockDeductions: (r.stock_deductions as unknown as StockDeduction[]).map((d) => ({ originId: d.originId, kg: Number(d.kg) })),
  history: events.map((e) => ({ at: e.at, label: e.label })).sort((a, b) => a.at.localeCompare(b.at)),
});

export const quoteFromRow = (r: Tables<'quote_requests'>): QuoteRequest => ({
  id: r.id,
  number: r.number,
  createdAt: r.created_at,
  businessType: r.business_type as BusinessType,
  company: r.company,
  contactName: r.contact_name,
  phone: r.phone,
  email: r.email,
  cityId: r.city_id,
  lines: r.lines as unknown as OrderLine[],
  weightKg: Number(r.weight_kg),
  indicativeTotal: Number(r.indicative_total),
  notes: r.notes,
  status: r.status as QuoteStatus,
  finalPrice: r.final_price === null ? null : Number(r.final_price),
  adminNotes: r.admin_notes,
  updatedAt: r.updated_at,
});

export const stockMovementFromRow = (r: Tables<'stock_movements'>): StockMovement => ({
  id: String(r.id),
  at: r.at,
  originId: r.origin_id,
  deltaKg: Number(r.delta_kg),
  reason: r.reason as StockReason,
  ref: r.ref,
  note: r.note,
});

/** A message the database queued for the team (notification_outbox): the sender (phase 4) sends it. */
export const notificationFromRow = (r: Tables<'notification_outbox'>): NotificationLog => ({
  id: String(r.id),
  at: r.created_at,
  channel: r.channel as NotificationChannel,
  event: r.event as NotificationEvent,
  to: r.recipient,
  subject: r.subject,
  body: r.body,
  status: r.status as NotificationLog['status'],
});
