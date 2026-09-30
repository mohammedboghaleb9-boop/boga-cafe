/**
 * BOGA CAFÉ — domain model.
 *
 * Everything in `src/core` is plain TypeScript with no React and no browser APIs,
 * so the exact same rules can run in the browser (live prices) and on the server
 * (authoritative checks when an order is placed).
 */

export type Locale = 'ar' | 'fr' | 'en';
export type Localized = Record<Locale, string>;

export type Species = 'arabica' | 'robusta';
export type RoastLevel = 'light' | 'medium' | 'medium-dark' | 'dark';

/** Bag sizes in grams. Coffee is sold as whole beans only. */
export type PackSize = 250 | 500 | 1000;
export const PACK_SIZES: readonly PackSize[] = [250, 500, 1000];

/** A coffee origin = one stock line, measured in kilograms. */
export interface Origin {
  id: string;
  name: Localized;
  /** ISO 3166-1 alpha-2, used for the flag. */
  countryCode: string;
  species: Species;
  region: string;
  roastLevel: RoastLevel;
  tastingNotes: Localized;
  /** Current stock in kg. */
  stockKg: number;
  /** Below this, the admin sees a low-stock alert. */
  lowStockKg: number;
  /** Price per kg used to compute Custom Blend prices (MAD). */
  pricePerKg: number;
  /** Admin switch: can customers use this origin in the Custom Blend builder? */
  customBlendEnabled: boolean;
  /** Estimated date when stock comes back (ISO yyyy-mm-dd), shown to customers. */
  restockDate?: string;
  active: boolean;
}

export interface RecipeLine {
  originId: string;
  /** Integer percentage, all lines of a recipe add up to 100. */
  percent: number;
}

/**
 * signature     – BOGA CAFÉ blends for everyone
 * single-origin – one origin, 100 %
 * b2b           – the 3 HORECA blends (visible to everyone)
 */
export type ProductKind = 'signature' | 'single-origin' | 'b2b';

export interface Product {
  id: string;
  slug: string;
  kind: ProductKind;
  name: Localized;
  tagline: Localized;
  description: Localized;
  recipe: RecipeLine[];
  roastLevel: RoastLevel;
  tastingNotes: Localized;
  /** Price per bag size (MAD). A size without a price is not offered. */
  prices: Partial<Record<PackSize, number>>;
  /** Optional photo (URL or data URL). Without it the UI draws the BOGA bag. */
  image?: string;
  featured: boolean;
  active: boolean;
  sortOrder: number;
}

export interface CustomBlendSpec {
  lines: RecipeLine[];
  size: PackSize;
}

export type CartItem =
  | { id: string; type: 'product'; productId: string; size: PackSize; qty: number }
  | { id: string; type: 'custom'; blend: CustomBlendSpec; qty: number };

export interface ShippingRate {
  id: string;
  city: Localized;
  /** Informational: distance from Oujda. */
  distanceKm: number;
  /** Fee covering the first `includedKg`. */
  baseFee: number;
  includedKg: number;
  /** Added per started kg above `includedKg`. */
  extraPerKg: number;
  deliveryDays: string;
  active: boolean;
}

export type PaymentMethodId = 'card' | 'cashplus' | 'bank_transfer';

export interface PaymentMethodConfig {
  id: PaymentMethodId;
  enabled: boolean;
  label: Localized;
  instructions: Localized;
}

export type OrderStatus =
  | 'new'
  | 'confirmed'
  | 'in_production'
  | 'shipped'
  | 'delivered'
  | 'cancelled';

export type PaymentStatus = 'pending' | 'awaiting_verification' | 'paid' | 'failed' | 'refunded';

export interface CustomerInfo {
  fullName: string;
  phone: string;
  email: string;
  cityId: string;
  address: string;
  company: string;
  notes: string;
}

/** What the order keeps for each line: a frozen copy, prices can change later. */
export interface OrderLine {
  kind: 'product' | 'custom';
  productId?: string;
  name: Localized;
  size: PackSize;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  /** Grams of each origin for ONE bag. */
  composition: { originId: string; percent: number; grams: number }[];
}

export interface StockDeduction {
  originId: string;
  kg: number;
}

export interface OrderEvent {
  at: string;
  label: string;
}

export interface Order {
  id: string;
  number: string;
  createdAt: string;
  locale: Locale;
  customer: CustomerInfo;
  lines: OrderLine[];
  weightKg: number;
  subtotal: number;
  shippingFee: number;
  total: number;
  paymentMethod: PaymentMethodId;
  paymentStatus: PaymentStatus;
  paymentRef?: string;
  status: OrderStatus;
  stockDeductions: StockDeduction[];
  history: OrderEvent[];
}

export type BusinessType = 'cafe' | 'hotel' | 'restaurant' | 'company' | 'individual' | 'other';

export type SampleStatus = 'new' | 'contacted' | 'approved' | 'shipped' | 'closed' | 'rejected';

export interface SampleRequest {
  id: string;
  number: string;
  createdAt: string;
  businessType: BusinessType;
  company: string;
  contactName: string;
  phone: string;
  email: string;
  cityId: string;
  productId: string;
  estMonthlyKg: number;
  notes: string;
  status: SampleStatus;
  /** Admin decision. null = not decided yet. */
  free: boolean | null;
  deliveryFee: number;
  adminNotes: string;
}

export type QuoteStatus = 'new' | 'negotiating' | 'confirmed' | 'closed';

/** Orders above the B2B threshold (10 kg) go through the administration. */
export interface QuoteRequest {
  id: string;
  number: string;
  createdAt: string;
  businessType: BusinessType;
  company: string;
  contactName: string;
  phone: string;
  email: string;
  cityId: string;
  lines: OrderLine[];
  weightKg: number;
  /** Website list price, for reference only. */
  indicativeTotal: number;
  notes: string;
  status: QuoteStatus;
  /** Final price decided by the administration. */
  finalPrice: number | null;
  adminNotes: string;
}

export type StockReason = 'order' | 'order_cancelled' | 'restock' | 'correction';

export interface StockMovement {
  id: string;
  at: string;
  originId: string;
  deltaKg: number;
  reason: StockReason;
  ref: string;
  note: string;
}

export type NotificationChannel = 'whatsapp' | 'email';
export type NotificationEvent = 'order.created' | 'payment.reported' | 'sample.created' | 'quote.created' | 'stock.low';

export interface NotificationLog {
  id: string;
  at: string;
  channel: NotificationChannel;
  event: NotificationEvent;
  to: string;
  subject: string;
  body: string;
  status: 'sent' | 'simulated' | 'failed';
}

export interface Settings {
  currency: 'MAD';
  /** Above this total weight the order becomes B2B (kg). */
  b2bThresholdKg: number;
  customBlend: {
    enabled: boolean;
    minPercent: number;
    maxOrigins: number;
    /** Bag, valve, label and blending work, added per bag size (MAD). */
    feeBySize: Record<PackSize, number>;
  };
  /**
   * Weight lost in roasting, in %. 0 when stock is counted in roasted coffee.
   * If stock is counted in green coffee, set ~15–18 so deductions stay correct.
   */
  roastLossPercent: number;
  /** Free delivery above this subtotal (MAD). 0 = never. */
  freeShippingOver: number;
  sampleSizeGrams: number;
  /**
   * An order holds its coffee until it is paid, for a limited time only
   * (src/core/order.ts reservationDeadline): this many hours after it was placed
   * while nothing is paid (or the payment was refused)…
   */
  unpaidOrderTimeoutHours: number;
  /** …and this many hours when the customer says they paid (transfer, Cash Plus) and the owner has to check the account. */
  paymentCheckTimeoutHours: number;
  contact: {
    whatsapp: string;
    email: string;
    instagram: string;
    tiktok: string;
    facebook: string;
    address: Localized;
  };
  notifications: {
    adminWhatsapp: string;
    adminEmail: string;
    whatsappEnabled: boolean;
    emailEnabled: boolean;
  };
  /** Where transfers go. Empty until the dedicated account exists: bank transfer is then not offered. */
  bank: {
    holder: string;
    bankName: string;
    rib: string;
  };
  /** Who receives Cash Plus payments. Empty until known: Cash Plus is then not offered. */
  cashplus: {
    beneficiary: string;
  };
}

export interface SiteContent {
  announcement: Localized;
  heroTitle: Localized;
  heroSubtitle: Localized;
  aboutTitle: Localized;
  aboutText: Localized;
}
