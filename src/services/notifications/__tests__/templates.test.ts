import { describe, expect, it } from 'vitest';
import type { QuoteRequest, SampleRequest } from '@/core/types';
import { seedOrigins, seedProducts } from '@/data/seed/catalog';
import { seedShippingRates } from '@/data/seed/config';
import { quoteMessage, sampleMessage, type TemplateContext } from '../templates';

const ctx: TemplateContext = {
  origins: seedOrigins,
  products: seedProducts,
  shippingRates: seedShippingRates,
  paymentLabel: (id) => id,
};
const b2b = seedProducts.find((p) => p.kind === 'b2b')!;

const sample: SampleRequest = {
  id: 's1',
  number: 'SR-2026-0004',
  createdAt: '2026-09-27T20:00:00.000Z',
  businessType: 'cafe',
  company: '',
  contactName: 'Sara Test',
  phone: '+212661000000',
  email: 'sara@example.com',
  cityId: 'oujda',
  productId: b2b.id,
  estMonthlyKg: 20,
  notes: '',
  status: 'new',
  free: null,
  deliveryFee: 20,
  adminNotes: '',
};

describe('messages sent to BOGA CAFÉ', () => {
  it('describes a sample request without placeholders when the company is empty', () => {
    const m = sampleMessage(sample, ctx);
    expect(m.whatsapp).toContain('Établissement : Café');
    expect(m.whatsapp).toContain('Contact : Sara Test (+212661000000)');
    expect(m.whatsapp).toContain('Email : sara@example.com');
    expect(m.whatsapp).toContain('Ville : Oujda');
    expect(m.whatsapp).not.toMatch(/^- /m);
    expect(m.subject).toBe('[BOGA CAFÉ] Échantillon B2B SR-2026-0004 - Sara Test');
  });

  it('names the establishment when there is one', () => {
    const m = sampleMessage({ ...sample, company: 'Café Andalous', businessType: 'restaurant' }, ctx);
    expect(m.whatsapp).toContain('Établissement : Café Andalous (Restaurant)');
    expect(m.subject).toContain('Café Andalous');
  });

  it('keeps messages free of invisible direction marks', () => {
    const quote: QuoteRequest = {
      id: 'q1',
      number: 'QR-2026-0002',
      createdAt: sample.createdAt,
      businessType: 'hotel',
      company: '',
      contactName: 'Hotel Test',
      phone: '+212662000000',
      email: '',
      cityId: 'fes',
      lines: [],
      weightKg: 11,
      indicativeTotal: 2860,
      notes: '',
      status: 'new',
      finalPrice: null,
      adminNotes: '',
    };
    const m = quoteMessage(quote, ctx);
    for (const text of [m.subject, m.whatsapp, m.email]) expect(text).not.toMatch(/[⁦-⁩]/);
    expect(m.subject).toBe('[BOGA CAFÉ] Demande B2B QR-2026-0002 - 11 kg');
    expect(m.whatsapp).toContain('Établissement : Hôtel');
  });
});
