/**
 * Database rows → the types of src/core. Pure functions, shared by the site and
 * the Edge Functions (src/server).
 */
import {
  PACK_SIZES,
  type Localized,
  type Origin,
  type PackSize,
  type PaymentMethodConfig,
  type PaymentMethodId,
  type Product,
  type Settings,
  type ShippingRate,
  type SiteContent,
} from '@/core/types';
import type { Json, Tables } from './database.types';

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
