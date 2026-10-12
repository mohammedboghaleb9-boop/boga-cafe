import { describe, expect, it } from 'vitest';
import { contactOk, methodOk, payeeProblem, rulesOk, shippingRateOk, type BusinessRules, type Payee } from '../config';
import { settings } from './fixtures';

const L = (fr: string) => ({ ar: '', fr, en: '' });
const rules: BusinessRules = { ...settings, customBlend: { ...settings.customBlend } };
const payee: Payee = {
  bank: { holder: 'TEST', bankName: 'TEST', rib: '000000000000000000000000' },
  cashplus: { beneficiary: 'TEST', city: 'Oujda', phone: '0600000000' },
};

// the same limits as supabase/migrations/20261012120000_settings_writes.sql: a form never sends what comes back "not saved"
describe('admin settings, checked as the database checks them', () => {
  it('rules: within their ranges, whole numbers where the database wants them', () => {
    expect(rulesOk(rules)).toBe(true);
    expect(rulesOk({ ...rules, roastLossPercent: 31 })).toBe(false);
    expect(rulesOk({ ...rules, unpaidOrderTimeoutHours: 0 })).toBe(false);
    expect(rulesOk({ ...rules, customBlend: { ...rules.customBlend, minPercent: 2.5 } })).toBe(false);
    expect(rulesOk({ ...rules, customBlend: { ...rules.customBlend, feeBySize: { ...rules.customBlend.feeBySize, 500: Number.NaN } } })).toBe(false);
  });

  it('payee: a 24-digit RIB, a whole transfer or none, a whole Cash Plus payee or none', () => {
    expect(payeeProblem(payee)).toBeNull();
    const empty = { bank: { holder: '', bankName: '', rib: '' }, cashplus: { beneficiary: '', city: '', phone: '' } };
    expect(payeeProblem(empty)).toBeNull(); // nothing yet: the methods stay closed
    expect(payeeProblem({ ...payee, bank: { ...payee.bank, rib: '00000000000000000000000' } })).toBe('invalid');
    expect(payeeProblem({ ...payee, cashplus: { ...payee.cashplus, phone: '06 00' } })).toBe('invalid');
    expect(payeeProblem({ ...payee, bank: { ...payee.bank, bankName: ' ' } })).toBe('incomplete');
    expect(payeeProblem({ ...payee, cashplus: { ...empty.cashplus, beneficiary: 'TEST' } })).toBe('incomplete');
  });

  it('contact links are https, a payment method needs a French name and the card stays off, a city its French name', () => {
    const contact = { whatsapp: '+212600000000', email: 'team@example.com', instagram: 'https://instagram.com/x', tiktok: '', facebook: '', address: L(''), hours: L('') };
    expect(contactOk(contact)).toBe(true);
    expect(contactOk({ ...contact, facebook: 'http://facebook.com/x' })).toBe(false);
    expect(contactOk({ ...contact, whatsapp: '06 00 00' })).toBe(false);
    const method = { id: 'bank_transfer' as const, enabled: true, label: L('Virement'), instructions: L('') };
    expect(methodOk(method)).toBe(true);
    expect(methodOk({ ...method, label: L(' ') })).toBe(false);
    expect(methodOk({ ...method, id: 'card', enabled: true })).toBe(false);
    const rate = { id: 'oujda', city: L('Oujda'), distanceKm: 0, baseFee: 20, includedKg: 3, extraPerKg: 5, deliveryDays: '1', active: true };
    expect(shippingRateOk(rate)).toBe(true);
    expect(shippingRateOk({ ...rate, baseFee: 1001 })).toBe(false);
    expect(shippingRateOk({ ...rate, distanceKm: 1.5 })).toBe(false);
  });
});
