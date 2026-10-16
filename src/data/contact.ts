import type { Settings } from '@/core/types';

/**
 * BOGA CAFÉ's real contact details, approved by the owner (docs/07 Q14, Q19, Q20), for the "coming
 * soon" page (src/coming-soon), which must not load the example catalog, prices and fees kept in
 * seed/config.ts. The same values as seedSettings.contact there (a test keeps them equal; that file
 * stays import-free for scripts/seed-sql.mjs, which Node runs without a bundler).
 */
export const BOGA_CONTACT: Settings['contact'] = {
  whatsapp: '+212609036378',
  email: 'bogacafe1@gmail.com',
  instagram: 'https://www.instagram.com/boga.cafe1',
  tiktok: 'https://www.tiktok.com/@bogacafe795',
  facebook: 'https://www.facebook.com/profile.php?id=61594620729419',
  address: { ar: 'وجدة، المغرب', fr: 'Oujda, Maroc', en: 'Oujda, Morocco' },
  // owner, 2026-09-30 (docs/07 Q19): every day, no day off
  hours: { ar: 'كل يوم، من 8:00 إلى 22:00', fr: 'Tous les jours, de 8 h à 22 h', en: 'Every day, 8 am to 10 pm' },
};
