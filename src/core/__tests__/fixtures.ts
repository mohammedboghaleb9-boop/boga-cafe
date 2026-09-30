import { indexOrigins } from '../recipe';
import type { Origin, Product, Settings, ShippingRate } from '../types';

const L = (s: string) => ({ ar: s, fr: s, en: s });

export const origin = (id: string, over: Partial<Origin> = {}): Origin => ({
  id,
  name: L(id),
  countryCode: 'BR',
  species: 'arabica',
  region: '',
  roastLevel: 'medium',
  tastingNotes: L(''),
  stockKg: 50,
  lowStockKg: 5,
  pricePerKg: 200,
  customBlendEnabled: true,
  active: true,
  ...over,
});

export const origins = [
  origin('brazil', { pricePerKg: 200 }),
  origin('colombia', { pricePerKg: 300 }),
  origin('vietnam', { species: 'robusta', pricePerKg: 100, stockKg: 1 }),
  origin('ethiopia', { stockKg: 0, restockDate: '2026-11-01', customBlendEnabled: false }),
];
export const originIndex = indexOrigins(origins);

export const product: Product = {
  id: 'signature',
  slug: 'signature',
  kind: 'signature',
  name: L('Signature'),
  tagline: L(''),
  description: L(''),
  recipe: [
    { originId: 'brazil', percent: 80 },
    { originId: 'vietnam', percent: 20 },
  ],
  roastLevel: 'medium',
  tastingNotes: L(''),
  prices: { 250: 60, 1000: 200 },
  featured: true,
  active: true,
  sortOrder: 1,
};

export const settings: Settings = {
  currency: 'MAD',
  b2bThresholdKg: 10,
  customBlend: { enabled: true, minPercent: 5, maxOrigins: 4, feeBySize: { 250: 10, 500: 15, 1000: 20 } },
  roastLossPercent: 0,
  freeShippingOver: 0,
  sampleSizeGrams: 500,
  unpaidOrderTimeoutHours: 48,
  paymentCheckTimeoutHours: 120,
  contact: { whatsapp: '', email: '', instagram: '', tiktok: '', facebook: '', address: L('') },
  notifications: { adminWhatsapp: '', adminEmail: '', whatsappEnabled: true, emailEnabled: true },
  bank: { holder: '', bankName: '', rib: '' },
  cashplus: { beneficiary: '' },
};

export const rate: ShippingRate = {
  id: 'oujda',
  city: L('Oujda'),
  distanceKm: 0,
  baseFee: 20,
  includedKg: 2,
  extraPerKg: 5,
  deliveryDays: '1',
  active: true,
};
