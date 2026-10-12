/**
 * What the Admin Panel's settings, payment, text, recipient and delivery forms may save:
 * the same limits the database checks (supabase/migrations/20261012183912_settings_writes.sql),
 * so a form never sends what would come back "not saved".
 */
import { PACK_SIZES, type Localized, type PaymentMethodConfig, type Settings, type ShippingRate, type SiteContent } from './types';

/** The parts of the settings saved by the Settings page (owner only). */
export type BusinessRules = Pick<Settings, 'b2bThresholdKg' | 'roastLossPercent' | 'unpaidOrderTimeoutHours' | 'paymentCheckTimeoutHours' | 'customBlend'>;

/** Who customers pay by transfer and Cash Plus (owner only). Never an identity card number. */
export type Payee = Pick<Settings, 'bank' | 'cashplus'>;

const between = (v: number, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const wholeBetween = (v: number, min: number, max: number) => between(v, min, max) && Number.isInteger(v);

/** Phone numbers as saved: digits, a leading + allowed, spaces and dashes removed by the form. */
export const PHONE = /^\+?[0-9]{8,15}$/;
/** A Moroccan RIB: 24 digits. Its check key is not verified: no official source for its rule was found. */
export const RIB = /^[0-9]{24}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const HTTPS = /^https:\/\/\S+$/;

/** Spaces, dots and dashes out, as the database keeps a phone number or a RIB. */
export const digitsOnly = (value: string) => value.replace(/[\s.-]/g, '');

/** The same RIB typed twice, whatever the spaces: the form's typing check (its key is not verified). */
export const sameRib = (a: string, b: string) => digitsOnly(a) === digitsOnly(b);

/**
 * A text without the spaces, tabs and line breaks at its start and end, as the database keeps it
 * (config_trim_str): only these four characters, and nothing inside the text changes.
 */
export const trimEnds = (value: string) => value.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '');
export const trimLocalized = (t: Localized): Localized => ({ ar: trimEnds(t.ar), fr: trimEnds(t.fr), en: trimEnds(t.en) });

/** A payee as it is checked and kept: names trimmed, the RIB and the phone in digits, these fields only. */
export const cleanPayee = ({ bank, cashplus }: Payee): Payee => ({
  bank: { holder: bank.holder.trim(), bankName: bank.bankName.trim(), rib: digitsOnly(bank.rib) },
  cashplus: { beneficiary: cashplus.beneficiary.trim(), city: cashplus.city.trim(), phone: digitsOnly(cashplus.phone) },
});

/** A text in three languages of at most `max` characters each once trimmed, with a French one when `required`. */
export const textOk = (text: Localized, max: number, required = false) =>
  Object.values(text).every((v) => trimEnds(v).length <= max) && (!required || trimEnds(text.fr) !== '');

/** Empty, or matching `pattern`, of at most `max` characters, once trimmed (the database trims first). */
const optional = (raw: string, max: number, pattern: RegExp) => {
  const value = trimEnds(raw);
  return value.length <= max && (value === '' || pattern.test(value));
};

export const rulesOk = (r: BusinessRules) =>
  between(r.b2bThresholdKg, 1, 1000) &&
  between(r.roastLossPercent, 0, 30) &&
  between(r.unpaidOrderTimeoutHours, 1, 720) &&
  between(r.paymentCheckTimeoutHours, 1, 720) &&
  wholeBetween(r.customBlend.minPercent, 1, 50) &&
  wholeBetween(r.customBlend.maxOrigins, 1, 8) &&
  PACK_SIZES.every((s) => between(r.customBlend.feeBySize[s], 0, 1000));

/** The highest free-shipping threshold, in DH (0 = never free). */
export const MAX_FREE_SHIPPING = 100_000;

/**
 * Why a payee cannot be saved: 'invalid' (a format or a length), 'incomplete' (a method is
 * offered once its payee is whole, so it is all filled in or all empty), or null.
 */
export function payeeProblem({ bank, cashplus }: Payee): 'invalid' | 'incomplete' | null {
  const valid =
    bank.holder.trim().length <= 80 &&
    bank.bankName.trim().length <= 80 &&
    optional(bank.rib, 24, RIB) &&
    cashplus.beneficiary.trim().length <= 80 &&
    cashplus.city.trim().length <= 60 &&
    optional(cashplus.phone, 16, PHONE);
  if (!valid) return 'invalid';
  const filled = (values: string[]) => values.filter((v) => v.trim() !== '').length;
  const bankFilled = filled([bank.holder, bank.bankName, bank.rib]);
  const cashFilled = filled([cashplus.beneficiary, cashplus.city, cashplus.phone]);
  return [0, 3].includes(bankFilled) && [0, 3].includes(cashFilled) ? null : 'incomplete';
}

export const CONTENT_MAX: Record<keyof SiteContent, number> = {
  announcement: 200,
  heroTitle: 120,
  heroSubtitle: 400,
  aboutTitle: 120,
  aboutText: 2000,
};

export const contentOk = (c: SiteContent) => (Object.keys(CONTENT_MAX) as (keyof SiteContent)[]).every((k) => textOk(c[k], CONTENT_MAX[k]));

export const contactOk = (c: Settings['contact']) =>
  optional(c.whatsapp, 16, PHONE) &&
  optional(c.email, 120, EMAIL) &&
  [c.instagram, c.tiktok, c.facebook].every((url) => optional(url, 200, HTTPS)) &&
  textOk(c.address, 200) &&
  textOk(c.hours, 200);

export const recipientsOk = (n: Settings['notifications']) => optional(n.adminWhatsapp, 16, PHONE) && optional(n.adminEmail, 120, EMAIL);

/** `cardGateway`: a card payment can be taken (services/payments): until then the card stays off. */
export const methodOk = (m: PaymentMethodConfig, cardGateway: boolean) =>
  textOk(m.label, 40, true) && textOk(m.instructions, 600) && !(m.id === 'card' && m.enabled && !cardGateway);

export const shippingRateOk = (r: ShippingRate) =>
  textOk(r.city, 60, true) &&
  wholeBetween(r.distanceKm, 0, 3000) &&
  between(r.baseFee, 0, 1000) &&
  between(r.includedKg, 0, 100) &&
  between(r.extraPerKg, 0, 1000) &&
  trimEnds(r.deliveryDays).length <= 20;

/** What each form sends: every text trimmed, as the database keeps it. */
export const trimmedContent = (c: SiteContent): SiteContent => ({
  announcement: trimLocalized(c.announcement),
  heroTitle: trimLocalized(c.heroTitle),
  heroSubtitle: trimLocalized(c.heroSubtitle),
  aboutTitle: trimLocalized(c.aboutTitle),
  aboutText: trimLocalized(c.aboutText),
});

export const trimmedContact = (c: Settings['contact']): Settings['contact'] => ({
  whatsapp: trimEnds(c.whatsapp),
  email: trimEnds(c.email),
  instagram: trimEnds(c.instagram),
  tiktok: trimEnds(c.tiktok),
  facebook: trimEnds(c.facebook),
  address: trimLocalized(c.address),
  hours: trimLocalized(c.hours),
});

export const trimmedRecipients = (n: Settings['notifications']): Settings['notifications'] => ({
  ...n,
  adminWhatsapp: trimEnds(n.adminWhatsapp),
  adminEmail: trimEnds(n.adminEmail),
});

export const trimmedMethod = (m: PaymentMethodConfig): PaymentMethodConfig => ({
  ...m,
  label: trimLocalized(m.label),
  instructions: trimLocalized(m.instructions),
});

export const trimmedRate = (r: ShippingRate): ShippingRate => ({ ...r, city: trimLocalized(r.city), deliveryDays: trimEnds(r.deliveryDays) });
