import { describe, expect, it } from 'vitest';
import type { QuoteRequest } from '@/core/types';
import { seedOrigins, seedProducts } from '@/data/seed/catalog';
import { seedShippingRates } from '@/data/seed/config';
import { quoteMessage, type TemplateContext } from '../templates';

const ctx: TemplateContext = {
  origins: seedOrigins,
  products: seedProducts,
  shippingRates: seedShippingRates,
  paymentLabel: (id) => id,
};

const quote: QuoteRequest = {
  id: 'q1',
  number: 'QR-2026-0002',
  createdAt: '2026-09-27T20:00:00.000Z',
  businessType: 'cafe',
  company: '',
  contactName: 'Sara Test',
  phone: '+212661000000',
  email: 'sara@example.com',
  cityId: 'oujda',
  lines: [],
  weightKg: 11,
  indicativeTotal: 2860,
  notes: '',
  status: 'new',
  finalPrice: null,
  adminNotes: '',
};

describe('messages sent to BOGA CAFÉ', () => {
  it('describes a B2B request without placeholders when the company is empty', () => {
    const m = quoteMessage(quote, ctx);
    expect(m.whatsapp).toContain('Établissement : Café');
    expect(m.whatsapp).toContain('Contact : Sara Test (+212661000000)');
    expect(m.whatsapp).toContain('Email : sara@example.com');
    expect(m.whatsapp).toContain('Ville : Oujda');
    expect(m.whatsapp).not.toContain('Note :');
    expect(m.subject).toBe('[BOGA CAFÉ] Demande B2B QR-2026-0002 - 11 kg');
  });

  it('names the establishment when there is one', () => {
    const m = quoteMessage({ ...quote, company: 'Café Andalous', businessType: 'restaurant' }, ctx);
    expect(m.whatsapp).toContain('Établissement : Café Andalous (Restaurant)');
  });

  it('keeps messages free of invisible direction marks', () => {
    const m = quoteMessage({ ...quote, businessType: 'hotel', email: '' }, ctx);
    for (const text of [m.subject, m.whatsapp, m.email]) expect(text).not.toMatch(/[⁦-⁩]/);
    expect(m.whatsapp).toContain('Établissement : Hôtel');
    expect(m.whatsapp).not.toContain('Email :');
  });
});
