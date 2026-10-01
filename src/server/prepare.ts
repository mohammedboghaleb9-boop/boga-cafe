/**
 * Pure part of the storefront server: from the request and the catalog read in
 * the database, build what will be saved and the arguments of the commit_*()
 * function, or the reasons it is refused. Same src/core rules as the site.
 */
import { buildOrder, type CheckoutContext, type CheckoutInput } from '@/core/order';
import { payeeReady } from '@/core/orderFlow';
import { indexOrigins } from '@/core/recipe';
import { buildQuoteRequest, type QuoteInput } from '@/core/requests';
import { seedSettings } from '@/data/seed/config';
import type { CatalogData } from '@/data/supabase/catalog';
import type { Json } from '@/data/supabase/database.types';
import { settingsFromRows } from '@/data/supabase/rows';
import { orderMessage, quoteMessage, type MessageDraft, type TemplateContext } from '@/services/notifications';

/** The commit_*() functions write the real number into the messages in place of this. */
export const NUMBER_PLACEHOLDER = '{number}';

const ids = (now: Date) => ({ id: '', number: NUMBER_PLACEHOLDER, now: now.toISOString() });

const templates = (c: CatalogData): TemplateContext => ({
  origins: c.origins,
  products: c.products,
  shippingRates: c.shippingRates,
  paymentLabel: (id) => c.paymentMethods.find((m) => m.id === id)?.label.fr ?? id,
});

/**
 * What a customer can use right now, as on the site (services/payments
 * methodAvailable): transfer and Cash Plus once the owner's real details exist;
 * the card never, until the CMI callback is on this server (phase D).
 */
function checkout(c: CatalogData): CheckoutContext {
  const settings = settingsFromRows(c.siteSettings, null, seedSettings);
  return {
    catalog: { products: c.products, origins: indexOrigins(c.origins) },
    settings,
    shippingRates: c.shippingRates,
    paymentMethods: c.paymentMethods.map((m) => ({ ...m, enabled: m.enabled && m.id !== 'card' && payeeReady(m.id, settings) })),
  };
}

const messageArgs = (m: MessageDraft) => ({ p_whatsapp: m.whatsapp, p_email: m.email, p_subject: m.subject });

export function prepareOrder(input: CheckoutInput, catalog: CatalogData, now: Date) {
  const result = buildOrder(input, checkout(catalog), ids(now));
  if (!result.ok) return result;
  return {
    ok: true as const,
    order: result.order,
    phone: result.order.customer.phone,
    args: { p_order: result.order as unknown as Json, ...messageArgs(orderMessage(result.order, templates(catalog))) },
  };
}

export function prepareQuote(input: QuoteInput, catalog: CatalogData, now: Date) {
  const result = buildQuoteRequest(input, checkout(catalog), ids(now));
  if (!result.ok) return result;
  return {
    ok: true as const,
    quote: result.quote,
    phone: result.quote.phone,
    args: { p_quote: result.quote as unknown as Json, ...messageArgs(quoteMessage(result.quote, templates(catalog))) },
  };
}
