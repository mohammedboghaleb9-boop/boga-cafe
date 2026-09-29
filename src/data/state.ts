import type {
  NotificationLog,
  Order,
  Origin,
  PaymentMethodConfig,
  Product,
  QuoteRequest,
  SampleRequest,
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
  samples: SampleRequest[];
  quotes: QuoteRequest[];
  stockMovements: StockMovement[];
  notifications: NotificationLog[];
}

/** Bump when the seed changes, so saved demo data in browsers is replaced. */
export const STATE_VERSION = 4; // 4: `counters` removed
