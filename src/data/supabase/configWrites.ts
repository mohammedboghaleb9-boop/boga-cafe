/**
 * The Admin Panel's settings, payments, texts, message recipients and delivery prices on
 * the live site (P5 slice 10), each through its database function (save_rules,
 * save_free_shipping, save_payee, save_content, save_recipients, save_payment_method,
 * save_shipping_rate). The functions check the role at aal2, every value, and the version
 * the page read; the role passed here is not trusted, the database decides. Each part is
 * sent with only its own keys: nothing else of the page reaches the database.
 */
import { cleanPayee, trimmedContact, trimmedContent, trimmedMethod, trimmedRate, trimmedRecipients, type BusinessRules, type Payee } from '@/core/config';
import type { PaymentMethodConfig, Settings, ShippingRate, SiteContent } from '@/core/types';
import { newShippingId } from '../ids';
import type { ConfigPart } from '../state';
import type { AdminData, Api } from '../types';
import type { Client } from './client';
import type { Json } from './database.types';
import { createCall, creating, unlessRefused } from './writeCall';

type Writes = Pick<
  Api,
  'saveRules' | 'setSalesOpen' | 'saveFreeShipping' | 'savePayee' | 'saveRecipients' | 'saveContent' | 'savePaymentMethod' | 'createShippingRate' | 'saveShippingRate'
>;

const rulesJson = ({ b2bThresholdKg, roastLossPercent, unpaidOrderTimeoutHours, paymentCheckTimeoutHours, customBlend }: BusinessRules): Json => ({
  b2bThresholdKg,
  roastLossPercent,
  unpaidOrderTimeoutHours,
  paymentCheckTimeoutHours,
  customBlend: { ...customBlend, feeBySize: { ...customBlend.feeBySize } },
});

/** Cleaned, and these fields only: there is no field for an identity card number. */
const payeeJson = (payee: Payee): Json => cleanPayee(payee);

/** Every text trimmed, as the database keeps it (config_trim_text): what is sent is what is saved. */
const contentJson = (content: SiteContent): Json => {
  const { announcement, heroTitle, heroSubtitle, aboutTitle, aboutText } = trimmedContent(content);
  return { announcement, heroTitle, heroSubtitle, aboutTitle, aboutText };
};

const contactJson = (contact: Settings['contact']): Json => {
  const { whatsapp, email, instagram, tiktok, facebook, address, hours } = trimmedContact(contact);
  return { whatsapp, email, instagram, tiktok, facebook, address, hours };
};

const rateJson = (rate: ShippingRate): Json => {
  const { id, city, distanceKm, baseFee, includedKg, extraPerKg, maxFee, deliveryDays, active } = trimmedRate(rate);
  // no cap: sent as null, so an edit can take a cap away
  return { id, city, distanceKm, baseFee, includedKg, extraPerKg, maxFee: maxFee ?? null, deliveryDays, active };
};

/** `client`: the admin's own (src/data/supabase/index.ts); `data`: what the panel shows, read again after each write. */
export function createConfigWrites(client: () => Client, data: AdminData): Writes {
  const call = createCall(client, data);
  /** A part's version as the page read it (null: never saved from the panel). */
  const seen = (part: ConfigPart) => data.db.get().configVersions?.[part] ?? null;
  /** Saved: true; refused (role, value, an older copy) or never read (no version to send): false; no answer: thrown. */
  const saved = (write: () => Promise<boolean | void>) => unlessRefused(async () => (await write()) !== false, false);

  return {
    saveRules: (rules) => saved(() => call('save_rules', { p_rules: rulesJson(rules), p_seen: seen('rules') })),
    setSalesOpen: (open) => saved(() => call('set_sales_open', { p_open: open, p_seen: seen('sales') })),

    saveFreeShipping: (amount) => saved(() => call('save_free_shipping', { p_amount: amount, p_seen: seen('freeShipping') })),

    savePayee: (payee) => saved(() => call('save_payee', { p_payee: payeeJson(payee), p_seen: seen('payee') })),

    saveRecipients: (recipients) =>
      saved(async () => {
        const at = seen('recipients');
        if (!at) return false; // the owner's read gives it: never sent blind
        const { adminWhatsapp, adminEmail, whatsappEnabled, emailEnabled } = trimmedRecipients(recipients);
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

    savePaymentMethod: (method: PaymentMethodConfig) =>
      saved(async () => {
        const { id, enabled, label, instructions, updatedAt } = trimmedMethod(method);
        if (!updatedAt) return false;
        await call('save_payment_method', { p_method: { id, enabled, label, instructions }, p_seen: updatedAt });
      }),

    // created hidden, with an id from its French name; it is shown by an edit, after a check
    createShippingRate: (draft) =>
      unlessRefused(async () => {
        const clean = trimmedRate(draft);
        const rate = { ...clean, id: newShippingId(clean.city.fr, data.db.get().shippingRates), active: false };
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
