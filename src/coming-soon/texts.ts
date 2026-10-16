import type { Locale } from '@/core/types';

/**
 * The few words of the "coming soon" page, in the site's three languages. Its own small table: the
 * site's dictionaries (src/i18n) also carry the shop, the admin panel and the prototype's texts.
 * No date, no product, no price: the owner opens the shop when the real catalog is ready.
 */
export const LOCALES: Locale[] = ['ar', 'fr', 'en'];

export const texts: Record<
  Locale,
  { dir: 'rtl' | 'ltr'; name: string; title: string; lead: string; contact: string; hours: string; language: string; pageTitle: string; description: string }
> = {
  ar: {
    dir: 'rtl',
    name: 'العربية',
    title: 'قريباً',
    lead: 'متجر BOGA CAFÉ الإلكتروني يفتح قريباً. لأي سؤال، راسلنا.',
    contact: 'تواصل معنا',
    hours: 'ساعات الرد:',
    language: 'اللغة',
    pageTitle: 'BOGA CAFÉ — قريباً',
    description: 'BOGA CAFÉ، وجدة. المتجر الإلكتروني يفتح قريباً.',
  },
  fr: {
    dir: 'ltr',
    name: 'Français',
    title: 'Bientôt en ligne',
    lead: 'La boutique en ligne BOGA CAFÉ ouvre bientôt. Pour toute question, écrivez-nous.',
    contact: 'Nous contacter',
    hours: 'Heures de réponse\u00a0:',
    language: 'Langue',
    pageTitle: 'BOGA CAFÉ — Bientôt en ligne',
    description: 'BOGA CAFÉ, Oujda. La boutique en ligne ouvre bientôt.',
  },
  en: {
    dir: 'ltr',
    name: 'English',
    title: 'Coming soon',
    lead: 'The BOGA CAFÉ online shop opens soon. For any question, write to us.',
    contact: 'Contact us',
    hours: 'Reply hours:',
    language: 'Language',
    pageTitle: 'BOGA CAFÉ — Coming soon',
    description: 'BOGA CAFÉ, Oujda. The online shop opens soon.',
  },
};
