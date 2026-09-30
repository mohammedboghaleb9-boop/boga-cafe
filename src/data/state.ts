import type {
  NotificationLog,
  Order,
  Origin,
  PaymentMethodConfig,
  Product,
  QuoteRequest,
  Settings,
  ShippingRate,
  SiteContent,
  StockMovement,
} from '@/core/types';

/** Everything the website and the admin read. Mirrors the database tables. */
export interface DbState {
  version: number;
  origins: Origin[];
  products: Product[];
  shippingRates: ShippingRate[];
  paymentMethods: PaymentMethodConfig[];
  settings: Settings;
  content: SiteContent;
  orders: Order[];
  quotes: QuoteRequest[];
  stockMovements: StockMovement[];
  notifications: NotificationLog[];
}

/** Bump when the seed changes, so saved demo data in browsers is replaced. */
export const STATE_VERSION = 8; // 8: reply hours on the contact page; 7: paid samples (B2B 250 g prices, no sample requests); 6: no automatic free delivery; 5: payment check deadline, Cash Plus payee, no example data outside the demo
