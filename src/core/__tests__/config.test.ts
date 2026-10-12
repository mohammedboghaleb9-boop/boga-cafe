import { describe, expect, it } from 'vitest';
import { contactOk, methodOk, payeeProblem, recipientsOk, rulesOk, sameRib, shippingRateOk, textOk, trimEnds, trimmedContact, trimmedContent, trimmedMethod, trimmedRate, trimmedRecipients, type BusinessRules, type Payee } from '../config';
import { settings } from './fixtures';

const L = (fr: string) => ({ ar: '', fr, en: '' });
const rules: BusinessRules = { ...settings, customBlend: { ...settings.customBlend } };
const payee: Payee = {
  bank: { holder: 'TEST', bankName: 'TEST', rib: '000000000000000000000000' },
  cashplus: { beneficiary: 'TEST', city: 'Oujda', phone: '0600000000' },
};

// the same limits as supabase/migrations/20261012183912_settings_writes.sql: a form never sends what comes back "not saved"
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
    expect(methodOk(method, false)).toBe(true);
    expect(methodOk({ ...method, label: L(' ') }, false)).toBe(false);
    expect(methodOk({ ...method, id: 'card', enabled: true }, false)).toBe(false); // no gateway yet: the card stays off
    expect(methodOk({ ...method, id: 'card', enabled: true }, true)).toBe(true); // the prototype's simulated gateway
    const rate = { id: 'oujda', city: L('Oujda'), distanceKm: 0, baseFee: 20, includedKg: 3, extraPerKg: 5, deliveryDays: '1', active: true };
    expect(shippingRateOk(rate)).toBe(true);
    expect(shippingRateOk({ ...rate, baseFee: 1001 })).toBe(false);
    expect(shippingRateOk({ ...rate, distanceKm: 1.5 })).toBe(false);
  });
});

// the same trimming as supabase/migrations/20261012230000_config_trim.sql: what a form sends is what is kept
describe('texts without the spaces at their start and end', () => {
  it('trims a space, a tab, a carriage return and a line feed, and changes nothing inside the text', () => {
    expect(trimEnds(' \t\r\n Titre \n ')).toBe('Titre');
    expect(trimEnds('Ligne 1\n\n  Ligne 2 ')).toBe('Ligne 1\n\n  Ligne 2');
    expect(trimEnds('   ')).toBe('');
    expect(trimEnds('\u00a0x\u00a0')).toBe('\u00a0x\u00a0'); // only the four characters the database trims
  });

  it('a limit and the French name count what is kept', () => {
    const edge = ' '.repeat(10);
    expect(textOk(L(edge + 'x'.repeat(120) + edge), 120)).toBe(true);
    expect(textOk(L('x'.repeat(121)), 120)).toBe(false);
    expect(textOk(L('   '), 40, true)).toBe(false);
    expect(contactOk({ whatsapp: ' +212600000000 ', email: ' team@example.com\n', instagram: ' https://instagram.com/x ', tiktok: '', facebook: '', address: L(''), hours: L('') })).toBe(true);
    expect(contactOk({ whatsapp: '', email: '', instagram: 'https://insta gram.com', tiktok: '', facebook: '', address: L(''), hours: L('') })).toBe(false); // a space inside is still a mistake
    expect(recipientsOk({ adminWhatsapp: ' +212600000000 ', adminEmail: ' team@example.com ', whatsappEnabled: true, emailEnabled: true })).toBe(true);
  });

  it('every form part is sent trimmed', () => {
    const padded = (fr: string) => ({ ar: ` ${fr} `, fr: ` ${fr}\n`, en: `\t${fr}` });
    expect(trimmedContent({ announcement: padded('a'), heroTitle: padded('b'), heroSubtitle: padded('c'), aboutTitle: padded('d'), aboutText: padded('e') }).aboutText).toEqual({ ar: 'e', fr: 'e', en: 'e' });
    const contact = trimmedContact({ whatsapp: ' 1 ', email: ' e ', instagram: ' i ', tiktok: ' t ', facebook: ' f ', address: padded('x'), hours: padded('y') });
    expect(contact).toEqual({ whatsapp: '1', email: 'e', instagram: 'i', tiktok: 't', facebook: 'f', address: { ar: 'x', fr: 'x', en: 'x' }, hours: { ar: 'y', fr: 'y', en: 'y' } });
    expect(trimmedRecipients({ adminWhatsapp: ' 1 ', adminEmail: ' e ', whatsappEnabled: false, emailEnabled: true })).toEqual({ adminWhatsapp: '1', adminEmail: 'e', whatsappEnabled: false, emailEnabled: true });
    expect(trimmedMethod({ id: 'cashplus', enabled: true, label: padded('Cash'), instructions: padded('Pay'), updatedAt: 't' })).toEqual({
      id: 'cashplus',
      enabled: true,
      label: { ar: 'Cash', fr: 'Cash', en: 'Cash' },
      instructions: { ar: 'Pay', fr: 'Pay', en: 'Pay' },
      updatedAt: 't',
    });
    expect(trimmedRate({ id: 'x', city: padded('Oujda'), distanceKm: 0, baseFee: 1, includedKg: 1, extraPerKg: 1, deliveryDays: ' 2-3 ', active: true })).toMatchObject({
      city: { ar: 'Oujda', fr: 'Oujda', en: 'Oujda' },
      deliveryDays: '2-3',
    });
  });
});

describe('a new RIB typed twice', () => {
  it('the two must be the same digits, whatever the spaces, dots and dashes', () => {
    expect(sameRib('0000 0000 0000 0000 0000 0001', '000000000000000000000001')).toBe(true);
    expect(sameRib('000000000000000000000001', '000000000000000000000010')).toBe(false);
    expect(sameRib('000000000000000000000001', '')).toBe(false);
  });
});
