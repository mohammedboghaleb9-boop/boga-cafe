import { Link } from 'react-router';
import type { Locale } from '@/core/types';
import { useI18n } from '@/i18n';

/**
 * The prototype's notice (demo build only: Header shows it under DEMO_DATA). Its texts live here, not in the
 * dictionaries, so the live builds leave them out; scripts/real-build.mjs refuses them in any real build.
 */
const texts: Record<Locale, { banner: string; openAdmin: string }> = {
  ar: {
    banner: 'نموذج تجريبي: المنتجات والأسعار والمخزون أمثلة، ولا يوجد دفع حقيقي. رسائل واتساب و Gmail التي ترسلها تصل فعلاً إلى BOGA CAFÉ.',
    openAdmin: 'فتح لوحة الإدارة',
  },
  fr: {
    banner: 'Prototype : produits, prix et stock sont des exemples, aucun paiement n’est réel. Les messages WhatsApp et Gmail que vous envoyez arrivent vraiment chez BOGA CAFÉ.',
    openAdmin: 'Ouvrir le Panel Admin',
  },
  en: {
    banner: 'Prototype: products, prices and stock are examples, and no payment is real. WhatsApp and Gmail messages you send really reach BOGA CAFÉ.',
    openAdmin: 'Open the Admin Panel',
  },
};

export function DemoBar() {
  const { locale } = useI18n();
  return (
    <div className="demo-bar">
      <div className="container spread">
        <span>{texts[locale].banner}</span>
        <Link to="/admin">
          {texts[locale].openAdmin} <span className="dir-arrow" aria-hidden="true">→</span>
        </Link>
      </div>
    </div>
  );
}
