/**
 * Business configuration for the prototype: delivery fees, payment methods,
 * settings and site texts. All of it is editable from the Admin Panel.
 * Contact details, bank details and fees are placeholders until confirmed.
 */
import type { PaymentMethodConfig, Settings, ShippingRate, SiteContent } from '@/core/types';

const city = (
  id: string,
  ar: string,
  fr: string,
  distanceKm: number,
  baseFee: number,
  deliveryDays: string,
): ShippingRate => ({
  id,
  city: { ar, fr, en: fr },
  distanceKm,
  baseFee,
  includedKg: 3,
  extraPerKg: 5,
  deliveryDays,
  active: true,
});

export const seedShippingRates: ShippingRate[] = [
  city('oujda', 'وجدة', 'Oujda', 0, 20, '1'),
  city('berkane', 'بركان', 'Berkane', 60, 25, '1–2'),
  city('nador', 'الناظور', 'Nador', 130, 30, '1–2'),
  city('taza', 'تازة', 'Taza', 220, 30, '2'),
  city('al-hoceima', 'الحسيمة', 'Al Hoceïma', 280, 35, '2–3'),
  city('fes', 'فاس', 'Fès', 340, 35, '2'),
  city('meknes', 'مكناس', 'Meknès', 400, 35, '2–3'),
  city('rabat', 'الرباط', 'Rabat', 540, 40, '2–3'),
  city('sale', 'سلا', 'Salé', 545, 40, '2–3'),
  city('kenitra', 'القنيطرة', 'Kénitra', 500, 40, '2–3'),
  city('casablanca', 'الدار البيضاء', 'Casablanca', 630, 40, '2–3'),
  city('mohammedia', 'المحمدية', 'Mohammedia', 610, 40, '2–3'),
  city('tanger', 'طنجة', 'Tanger', 600, 45, '2–3'),
  city('tetouan', 'تطوان', 'Tétouan', 540, 45, '2–3'),
  city('el-jadida', 'الجديدة', 'El Jadida', 720, 45, '3'),
  city('beni-mellal', 'بني ملال', 'Béni Mellal', 750, 45, '3'),
  city('marrakech', 'مراكش', 'Marrakech', 870, 45, '3'),
  city('agadir', 'أكادير', 'Agadir', 1100, 50, '3–4'),
  city('laayoune', 'العيون', 'Laâyoune', 1700, 70, '4–5'),
  city('dakhla', 'الداخلة', 'Dakhla', 2200, 80, '5–6'),
];

export const seedPaymentMethods: PaymentMethodConfig[] = [
  {
    id: 'card',
    enabled: true,
    label: { ar: 'بطاقة بنكية', fr: 'Carte bancaire', en: 'Bank card' },
    instructions: {
      ar: 'دفع آمن عبر صفحة CMI (3-D Secure). Visa و Mastercard والبطاقات المغربية.',
      fr: 'Paiement sécurisé sur la page du CMI (3-D Secure). Visa, Mastercard et cartes marocaines.',
      en: 'Secure payment on the CMI page (3-D Secure). Visa, Mastercard and Moroccan cards.',
    },
  },
  {
    id: 'cashplus',
    enabled: true,
    label: { ar: 'كاش بلوس', fr: 'Cash Plus', en: 'Cash Plus' },
    instructions: {
      ar: 'أرسل المبلغ عبر وكالة كاش بلوس باسم المستفيد أدناه مع رقم الطلب، ثم أرسل صورة الوصل على واتساب.',
      fr: "Envoyez le montant depuis une agence Cash Plus au bénéficiaire ci-dessous avec le numéro de commande, puis envoyez la photo du reçu sur WhatsApp.",
      en: 'Send the amount from a Cash Plus agency to the beneficiary below with the order number, then send a photo of the receipt on WhatsApp.',
    },
  },
  {
    id: 'bank_transfer',
    enabled: true,
    label: { ar: 'تحويل بنكي', fr: 'Virement bancaire', en: 'Bank transfer' },
    instructions: {
      ar: 'قم بالتحويل إلى الحساب أدناه مع ذكر رقم الطلب. نبدأ التحضير فور وصول المبلغ.',
      fr: 'Faites un virement vers le compte ci-dessous en indiquant le numéro de commande. La préparation commence dès réception.',
      en: 'Transfer to the account below with the order number as reference. Preparation starts as soon as it arrives.',
    },
  },
];

export const seedSettings: Settings = {
  currency: 'MAD',
  b2bThresholdKg: 10,
  customBlend: {
    enabled: true,
    minPercent: 5,
    maxOrigins: 4,
    feeBySize: { 250: 10, 500: 15, 1000: 20 },
  },
  roastLossPercent: 0,
  freeShippingOver: 600,
  sampleSizeGrams: 500,
  unpaidOrderTimeoutHours: 48,
  contact: {
    whatsapp: '+212600000000',
    email: 'bogacafe@gmail.com',
    instagram: 'https://www.instagram.com/',
    tiktok: 'https://www.tiktok.com/',
    facebook: 'https://www.facebook.com/',
    address: { ar: 'وجدة، المغرب', fr: 'Oujda, Maroc', en: 'Oujda, Morocco' },
  },
  notifications: {
    adminWhatsapp: '+212600000000',
    adminEmail: 'bogacafe@gmail.com',
    whatsappEnabled: true,
    emailEnabled: true,
  },
  bank: {
    holder: 'BOGA CAFE',
    bankName: '— à définir —',
    rib: '000 000 0000000000000000 00',
  },
};

export const seedContent: SiteContent = {
  announcement: {
    ar: 'توصيل لجميع مدن المغرب · قهوة حبوب فقط · محمّصة خصيصاً لـ BOGA CAFÉ',
    fr: 'Livraison dans tout le Maroc · Café en grains uniquement · Torréfié pour BOGA CAFÉ',
    en: 'Delivery across Morocco · Whole beans only · Roasted for BOGA CAFÉ',
  },
  heroTitle: {
    ar: 'قهوة حبوب، محمّصة من أجلك.',
    fr: 'Café en grains, torréfié pour vous.',
    en: 'Whole-bean coffee, roasted for you.',
  },
  heroSubtitle: {
    ar: 'خلطات مميزة، قهوة أحادية المصدر، وخلطة خاصة تركّبها بنفسك. من وجدة، مع التوصيل لكل مدن المغرب.',
    fr: 'Blends signature, single origin et un Custom Blend que vous composez vous-même. Depuis Oujda, livré partout au Maroc.',
    en: 'Signature blends, single origins and a Custom Blend you compose yourself. From Oujda, delivered across Morocco.',
  },
  aboutTitle: {
    ar: 'علامتنا، وصفاتنا، وتحميص حسب مواصفاتنا',
    fr: 'Nos recettes, notre marque, une torréfaction sur cahier des charges',
    en: 'Our recipes, our brand, roasted to our specification',
  },
  aboutText: {
    ar: 'تحدد BOGA CAFÉ وصفاتها ونسب خلطاتها ومواصفات كل منتج، ويقوم شريكنا المحمّص بالتحميص وفق هذه المواصفات بالضبط. بعد ذلك تُعبّأ القهوة في أكياس BOGA CAFÉ وتصلك حبوباً كاملة لتحافظ على نكهتها.',
    fr: 'BOGA CAFÉ définit ses recettes, ses proportions et les spécifications de chaque produit. Notre torréfacteur partenaire torréfie exactement selon ce cahier des charges, puis le café est conditionné dans les sachets BOGA CAFÉ et vous arrive en grains entiers pour garder tous ses arômes.',
    en: 'BOGA CAFÉ defines its recipes, proportions and the specification of every product. Our partner roaster roasts exactly to that specification, then the coffee is packed in BOGA CAFÉ bags and reaches you as whole beans to keep every aroma.',
  },
};
