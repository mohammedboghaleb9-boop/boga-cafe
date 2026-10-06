/**
 * The contract every data backend fulfils (src/data/demo today, Supabase next).
 * Pages only see it through `api` (src/data/api.ts) and the hooks, so changing
 * where data lives never touches a page. Every call is async: on a server each
 * one is a network request.
 */
import type { CheckoutError, CheckoutInput } from '@/core/order';
import type { AdminRole, StatusRefusal } from '@/core/orderFlow';
import type { QuoteInput, RequestError } from '@/core/requests';
import type {
  Order,
  OrderStatus,
  Origin,
  PaymentMethodConfig,
  PaymentStatus,
  Product,
  QuoteRequest,
  Settings,
  ShippingRate,
  SiteContent,
  StockReason,
} from '@/core/types';
import type { MessageDraft } from '@/services/notifications';
import type { DbState } from './state';

export type { ContactRequestInput, RequestError } from '@/core/requests';

export type PlaceOrderResult = { ok: true; order: Order } | { ok: false; errors: CheckoutError[] };
export type QuoteResult = { ok: true; quote: QuoteRequest; message: MessageDraft } | { ok: false; errors: RequestError[] };

export interface Api {
  /* Storefront */
  placeOrder(input: CheckoutInput): Promise<PlaceOrderResult>;
  /** Card gateway answer (CMI callback in production). */
  completeCardPayment(orderId: string, success: boolean): Promise<void>;
  /** Customer says "I have paid" for Cash Plus / transfer and gives the receipt reference. */
  reportOfflinePayment(orderId: string, paymentRef: string): Promise<void>;
  /** Cart above the B2B threshold → request handled by the administration. */
  requestQuote(input: QuoteInput): Promise<QuoteResult>;

  /* Admin */
  /** Why the change is refused for this role (core/orderFlow), or null once done. */
  setOrderStatus(orderId: string, status: OrderStatus, role: AdminRole): Promise<StatusRefusal | null>;
  /** Cancels the orders not paid by their deadline; how many were cancelled. */
  expireUnpaidOrders(): Promise<number>;
  /** False when refused (only the owner records payments, in a sensible order). */
  setPaymentStatus(orderId: string, paymentStatus: PaymentStatus, role: AdminRole): Promise<boolean>;
  /** New product: its id and address come from the name and never replace an existing product. */
  createProduct(draft: Product): Promise<Product>;
  /** False if there is no product with this id (use createProduct). */
  saveProduct(product: Product): Promise<boolean>;
  deleteProduct(id: string): Promise<void>;
  /** Null without a real price per kg. */
  createOrigin(draft: Origin): Promise<Origin | null>;
  /** Saves origin details; stock changes only through `adjustStock`, so every change is logged. */
  saveOrigin(origin: Origin): Promise<boolean>;
  adjustStock(originId: string, deltaKg: number, reason: StockReason, note: string): Promise<void>;
  saveShippingRate(rate: ShippingRate): Promise<void>;
  deleteShippingRate(id: string): Promise<void>;
  savePaymentMethod(method: PaymentMethodConfig): Promise<void>;
  /** False when the role may not change these settings (core/orderFlow MANAGER_SETTINGS). */
  saveSettings(settings: Settings, role: AdminRole): Promise<boolean>;
  saveContent(content: SiteContent): Promise<void>;
  updateQuote(id: string, patch: Partial<QuoteRequest>): Promise<void>;
  resetDemo(): Promise<void>;
}

/** Read side of a backend: the whole state, and a way to hear about changes. */
export interface ReadStore<T> {
  get(): T;
  subscribe(listener: () => void): () => void;
}

/** Where the first data load stands: the browser store is ready at once, a server answers later. */
export type DataStatus = 'loading' | 'ready' | 'error';

export interface Backend {
  db: ReadStore<DbState>;
  api: Api;
  status: ReadStore<DataStatus>;
  /** Loads the data again after an error. */
  retry(): void;
}
