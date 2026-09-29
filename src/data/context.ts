import type { CheckoutContext } from '@/core/order';
import { indexOrigins } from '@/core/recipe';
import type { TemplateContext } from '@/services/notifications';
import { methodAvailable } from '@/services/payments';
import type { DbState } from './state';

export const checkoutContext = (s: DbState): CheckoutContext => ({
  catalog: { products: s.products, origins: indexOrigins(s.origins) },
  settings: s.settings,
  shippingRates: s.shippingRates,
  paymentMethods: s.paymentMethods,
});

/** What a customer can use right now: the storefront checkout (the card needs a gateway). */
export const storefrontCheckoutContext = (s: DbState): CheckoutContext => ({
  ...checkoutContext(s),
  paymentMethods: s.paymentMethods.map((m) => ({ ...m, enabled: methodAvailable(m) })),
});

export const templateContext = (s: DbState): TemplateContext => ({
  origins: s.origins,
  products: s.products,
  shippingRates: s.shippingRates,
  paymentLabel: (id) => s.paymentMethods.find((m) => m.id === id)?.label.fr ?? id,
});
