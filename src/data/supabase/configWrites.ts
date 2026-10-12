/**
 * The Admin Panel's settings, payments, texts, message recipients and delivery prices on
 * the live site (P5 slice 10), each through its database function (save_rules,
 * save_free_shipping, save_payee, save_content, save_recipients, save_payment_method,
 * save_shipping_rate). The functions check the role at aal2, every value, and the version
 * the page read; the role passed here is not trusted, the database decides. Each part is
 * sent with only its own keys: nothing else of the page reaches the database.
 */
import type { BusinessRules, Payee } from '@/core/config';
import type { PaymentMethodConfig, Settings, ShippingRate, SiteContent } from '@/core/types';
import { newShippingId } from '../ids';
import type { ConfigPart } from '../state';
import type { AdminData, Api } from '../types';
import type { Client } from './client';
import type { Json } from './database.types';
import { createCall, creating, unlessRefused } from './writeCall';

type Writes = Pick<
  Api,
  'saveRules' | 'saveFreeShipping' | 'savePayee' | 'saveRecipients' | 'saveContent' | 'savePaymentMethod' | 'createShippingRate' | 'saveShippingRate'
>;

const rulesJson = ({ b2bThresholdKg, roastLossPercent, unpaidOrderTimeoutHours, paymentCheckTimeoutHours, customBlend }: BusinessRules): Json => ({
  b2bThresholdKg,
  roastLossPercent,
  unpaidOrderTimeoutHours,
  paymentCheckTimeoutHours,
  customBlend: { ...customBlend, feeBySize: { ...customBlend.feeBySize } },
});

/** Trimmed, and these fields only: there is no field for an identity card number. */
const payeeJson = ({ bank, cashplus }: Payee): Json => ({
  bank: { holder: bank.holder.trim(), bankName: bank.bankName.trim(), rib: bank.rib },
  cashplus: { beneficiary: cashplus.beneficiary.trim(), city: cashplus.city.trim(), phone: cashplus.phone },
});

const contentJson = ({ announcement, heroTitle, heroSubtitle, aboutTitle, aboutText }: SiteContent): Json => ({
  announcement,
  heroTitle,
  heroSubtitle,
  aboutTitle,
  aboutText,
});

const contactJson = ({ whatsapp, email, instagram, tiktok, facebook, address, hours }: Settings['contact']): Json => ({
  whatsapp,
  email,
  instagram,
  tiktok,
  facebook,
  address,
  hours,
});

const rateJson = ({ id, city, distanceKm, baseFee, includedKg, extraPerKg, deliveryDays, active }: ShippingRate): Json => ({
  id,
  city,
  distanceKm,
  baseFee,
  includedKg,
  extraPerKg,
  deliveryDays,
  active,
});

/** `client`: the admin's own (src/data/supabase/index.ts); `data`: what the panel shows, read again after each write. */
export function createConfigWrites(client: () => Client, data: AdminData): Writes {
  const call = createCall(client, data);
  /** A part's version as the page read it (null: never saved from the panel). */
  const seen = (part: ConfigPart) => data.db.get().configVersions?.[part] ?? null;
  /** Saved: true; refused (role, value, an older copy) or never read (no version to send): false; no answer: thrown. */
  const saved = (write: () => Promise<boolean | void>) => unlessRefused(async () => (await write()) !== false, false);

  return {
    saveRules: (rules) => saved(() => call('save_rules', { p_rules: rulesJson(rules), p_seen: seen('rules') })),

    saveFreeShipping: (amount) => saved(() => call('save_free_shipping', { p_amount: amount, p_seen: seen('freeShipping') })),

    savePayee: (payee) => saved(() => call('save_payee', { p_payee: payeeJson(payee), p_seen: seen('payee') })),

    saveRecipients: (recipients) =>
      saved(async () => {
        const at = seen('recipients');
        if (!at) return false; // the owner's read gives it: never sent blind
        const { adminWhatsapp, adminEmail, whatsappEnabled, emailEnabled } = recipients;
        await call('save_recipients', { p_recipients: { adminWhatsapp, adminEmail, whatsappEnabled, emailEnabled }, p_seen: at });
      }),

    // the contact details only when given (the owner's page): a manager's save leaves them as they are
    saveContent: (content, contact) =>
      saved(() =>
        call('save_content', {
          p_content: contentJson(content),
          p_contact: contact && contactJson(contact),
          p_seen_content: seen('content'),
          p_seen_contact: contact ? seen('contact') : null,
        }),
      ),

    savePaymentMethod: ({ id, enabled, label, instructions, updatedAt }: PaymentMethodConfig) =>
      saved(async () => {
        if (!updatedAt) return false;
        await call('save_payment_method', { p_method: { id, enabled, label, instructions }, p_seen: updatedAt });
      }),

    // created hidden, with an id from its French name; it is shown by an edit, after a check
    createShippingRate: (draft) =>
      unlessRefused(async () => {
        const rate = { ...draft, id: newShippingId(draft.city.fr, data.db.get().shippingRates), active: false };
        await creating(
          () => call('save_shipping_rate', { p_rate: rateJson(rate), p_seen: null }),
          () => data.db.get().shippingRates.some((r) => r.id === rate.id),
        );
        return rate;
      }, null),

    saveShippingRate: (rate) =>
      saved(async () => {
        if (!rate.updatedAt) return false;
        await call('save_shipping_rate', { p_rate: rateJson(rate), p_seen: rate.updatedAt });
      }),
  };
}
