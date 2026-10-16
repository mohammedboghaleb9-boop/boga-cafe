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

/** The parts of the settings the panel saves, each with its own version mark on the live site. */
export type ConfigPart = 'rules' | 'freeShipping' | 'payee' | 'content' | 'contact' | 'recipients' | 'sales';

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
  /** Live site: each settings part's version as read (a save from an older copy is refused); none in the prototype. */
  configVersions?: Partial<Record<ConfigPart, string>>;
  /** Live site, owner only: when the payee details last changed and by whom; 'unknown' when that could not be read. */
  payeeChange?: { at: string; by: string } | 'unknown';
}

/** Bump when the seed changes, so saved demo data in browsers is replaced. */
export const STATE_VERSION = 10; // 10: sales closed by default (the prototype opens them), an origin's price may be empty, a delivery cap; 9: Cash Plus payee city and phone; 8: reply hours on the contact page; 7: paid samples (B2B 250 g prices, no sample requests); 6: no automatic free delivery; 5: payment check deadline, Cash Plus payee, no example data outside the demo
