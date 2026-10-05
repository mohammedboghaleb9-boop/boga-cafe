/**
 * Reads what the storefront needs. Shared by the site (visitors see active rows
 * only, admins everything, through row level security) and the storefront Edge
 * Function (secret key, sees everything).
 */
import type { Origin, PaymentMethodConfig, Product, ShippingRate } from '@/core/types';
import { must, rows, type Client } from './client';
import type { Json } from './database.types';
import { byOriginOrder, byPaymentOrder, originFromRow, paymentMethodFromRow, productFromRow, shippingRateFromRow } from './rows';

export interface CatalogData {
  origins: Origin[];
  products: Product[];
  shippingRates: ShippingRate[];
  paymentMethods: PaymentMethodConfig[];
  /** site_config.settings and .content as stored; merged with the code defaults by the caller. */
  siteSettings: Json | undefined;
  content: Json | undefined;
}

export async function loadCatalog(db: Client): Promise<CatalogData> {
  const [origins, products, rates, methods, config] = await Promise.all([
    db.from('origins').select('*'),
    db.from('products').select('*, product_recipes(origin_id, percent)').order('sort_order'),
    db.from('shipping_rates').select('*').order('distance_km').order('id'),
    db.from('payment_methods').select('*'),
    db.from('site_config').select('settings, content').eq('id', 1).maybeSingle(),
  ]);
  const site = must(config);
  return {
    origins: rows(origins).map(originFromRow).sort(byOriginOrder),
    products: rows(products).map(productFromRow),
    shippingRates: rows(rates).map(shippingRateFromRow),
    paymentMethods: rows(methods).map(paymentMethodFromRow).sort(byPaymentOrder),
    siteSettings: site?.settings,
    content: site?.content,
  };
}
