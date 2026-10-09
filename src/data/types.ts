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

/**
 * Refusals that are not about the form (live site only): 'server' = no answer,
 * or one the site cannot read; 'too_many' = the server's limits per phone or
 * connection; 'captcha' = the anti-robot check failed.
 */
export type GuardError = 'server' | 'too_many' | 'captcha';
export const GUARD_ERRORS: readonly GuardError[] = ['server', 'too_many', 'captcha'];

/** Proof sent with a public form: the Turnstile token (src/shared/ui/Captcha.tsx); ignored where there is no server. */
export interface FormGuard {
  captchaToken: string;
}

export type PlaceOrderResult = { ok: true; order: Order } | { ok: false; errors: (CheckoutError | GuardError)[] };
export type QuoteResult = { ok: true; quote: QuoteRequest; message: MessageDraft } | { ok: false; errors: (RequestError | GuardError)[] };

export interface Api {
  /* Storefront */
  placeOrder(input: CheckoutInput, guard?: FormGuard): Promise<PlaceOrderResult>;
  /** Card gateway answer (CMI callback in production). */
  completeCardPayment(orderId: string, success: boolean): Promise<void>;
  /** Customer says "I have paid" for Cash Plus / transfer and gives the receipt reference; false if it could not be sent. */
  reportOfflinePayment(orderId: string, paymentRef: string): Promise<boolean>;
  /** Brings an order into the state when the customer opens its link (live site: from this tab, else from the server). */
  loadOrder(orderId: string): Promise<void>;
  /** Cart above the B2B threshold → request handled by the administration. */
  requestQuote(input: QuoteInput, guard?: FormGuard): Promise<QuoteResult>;

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

/**
 * Where the admin's sign-in stands. 'denied' = the password was right but the account
 * is not an admin: it has been signed out again. 'second_factor' = an admin account
 * past its password (aal1): the panel waits for the authenticator app's code, after
 * setting the app up when the account has none yet (`enrolled` false). `problem` on
 * 'signed_out': a kept session could not be checked (no connection); it stays kept.
 */
export type AdminSession =
  | { state: 'loading' }
  | { state: 'signed_out'; problem?: 'server' }
  | { state: 'denied' }
  | { state: 'second_factor'; enrolled: boolean }
  | { state: 'signed_in'; role: AdminRole };

/** Prototype: a role and the public demo password. Live site: the admin's own account. */
export type SignInInput = { role: AdminRole; password: string } | { email: string; password: string };

/**
 * 'credentials' covers every refusal of the email or the password alike, so the
 * answer never tells whether an account exists; 'too_many' = Auth's rate limit;
 * 'denied' = signed in, but not an admin (the session says so too).
 */
export type SignInResult = 'ok' | 'denied' | 'credentials' | 'too_many' | 'server';

/** The authenticator app to set up: shown once, kept nowhere (not stored, never logged). */
export interface TotpSetup {
  /** The QR code, an image URL (data:image/svg+xml). */
  qrCode: string;
  /** The same secret as text, for an app that cannot scan. */
  secret: string;
}

/** One answer for every refused code (wrong, expired, unknown), as for the password. */
export type CodeResult = 'ok' | 'denied' | 'wrong_code' | 'too_many' | 'server';

/** The second sign-in step (live site): the panel opens only at aal2. */
export interface SecondFactor {
  /** At 'second_factor' with `enrolled` false: a new app setup (an unfinished one is dropped). */
  setUp(): Promise<TotpSetup | 'too_many' | 'server'>;
  /** The 6-digit code: finishes the setup, or the sign-in when the app was set up before. */
  verify(code: string): Promise<CodeResult>;
}

export interface AdminAuth {
  session: ReadStore<AdminSession>;
  signIn(input: SignInInput): Promise<SignInResult>;
  signOut(): Promise<void>;
  /** From the "no access" page back to the sign-in form. */
  dismiss(): void;
  /** Checks the kept session again (after 'signed_out' with a problem). */
  retry(): void;
  /** The prototype's public password (demo build only). */
  demoPassword?: string;
  /** Live site only: the prototype has no second step. */
  secondFactor?: SecondFactor;
}

/** Read side of a backend: the whole state, and a way to hear about changes. */
export interface ReadStore<T> {
  get(): T;
  subscribe(listener: () => void): () => void;
}

/** Where the first data load stands: the browser store is ready at once, a server answers later. */
export type DataStatus = 'loading' | 'ready' | 'error';

/** What the Admin Panel can change; on the live site each part connects in its own slice (8-10). */
export type AdminWriteArea = 'orders' | 'b2b' | 'catalog' | 'stock' | 'shipping' | 'payments' | 'settings' | 'content' | 'notifications';
export const ADMIN_WRITE_AREAS: readonly AdminWriteArea[] = ['orders', 'b2b', 'catalog', 'stock', 'shipping', 'payments', 'settings', 'content', 'notifications'];

/**
 * What the Admin Panel reads, apart from the shop's copy: on the live site the
 * admin's own session reads every order, request, movement and inactive product
 * (row level security, aal2). 'error' when a read failed or the database did not
 * count the session as an admin: never an empty list in place of the real one.
 */
export interface AdminData {
  db: ReadStore<DbState>;
  status: ReadStore<DataStatus>;
  /** Reads everything again (the "refresh" button, "try again" after an error). */
  reload(): void;
  /** Reads everything again after a write, the page staying on screen. */
  refresh(): Promise<void>;
}

export interface Backend {
  db: ReadStore<DbState>;
  api: Api;
  status: ReadStore<DataStatus>;
  /** Loads the data again after an error. */
  retry(): void;
  /** Admin sign-in (the Admin Panel only). */
  admin: AdminAuth;
  /** The Admin Panel's data, once signed in. */
  adminData: AdminData;
  /** What the Admin Panel can save; every other button is off, with a "coming soon" note. */
  adminWrites: readonly AdminWriteArea[];
}
