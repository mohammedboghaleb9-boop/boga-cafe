import type { Settings, SiteContent } from '@/core/types';
import { BOGA_CONTACT } from './contact';

/**
 * What the live site (and its storefront server) assumes for a setting the database row does not hold:
 * the values the database functions themselves use for a missing key (check_order and commit_order in
 * 20261016120000_catalog_ready.sql, expire_unpaid_orders), so the site and the database price the same
 * order the same way. Never the prototype's examples (seed/): sales closed, Custom Blend off and no fee,
 * no payee (no transfer or Cash Plus offered), no recipient. The contact details are the real ones.
 */
export const LIVE_DEFAULT_SETTINGS: Settings = {
  currency: 'MAD',
  salesOpen: false,
  b2bThresholdKg: 10,
  customBlend: { enabled: false, minPercent: 5, maxOrigins: 4, feeBySize: { 250: 0, 500: 0, 1000: 0 } },
  roastLossPercent: 0,
  freeShippingOver: 0,
  unpaidOrderTimeoutHours: 48,
  paymentCheckTimeoutHours: 120,
  contact: BOGA_CONTACT,
  notifications: { adminWhatsapp: '', adminEmail: '', whatsappEnabled: false, emailEnabled: false },
  bank: { holder: '', bankName: '', rib: '' },
  cashplus: { beneficiary: '', city: '', phone: '' },
};

const blank = { ar: '', fr: '', en: '' };

/** A text the live row does not hold stays empty: no example copy. */
export const EMPTY_CONTENT: SiteContent = {
  announcement: blank,
  heroTitle: blank,
  heroSubtitle: blank,
  aboutTitle: blank,
  aboutText: blank,
};
