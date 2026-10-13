/**
 * The settings, payments, texts, recipients and delivery writes on the live site (slice 10):
 * each part goes to its database function with only its own keys and the version the page
 * read; a refusal is "not saved", no answer is an error, and nothing is sent unread.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Payee } from '@/core/config';
import type { PaymentMethodConfig, Settings, ShippingRate, SiteContent } from '@/core/types';
import { STATE_VERSION, type DbState } from '../../state';
import type { AdminData } from '../../types';
import type { Client } from '../client';
import { createConfigWrites } from '../configWrites';
import { WriteFailed } from '../writeCall';

const L = (fr: string) => ({ ar: '', fr, en: '' });
const oujda: ShippingRate = { id: 'oujda', city: L('Oujda'), distanceKm: 0, baseFee: 20, includedKg: 3, extraPerKg: 5, deliveryDays: '1', active: true, updatedAt: '2026-10-12T10:00:00.000001+00:00' };
const method: PaymentMethodConfig = { id: 'bank_transfer', enabled: true, label: L('Virement'), instructions: L(''), updatedAt: '2026-10-12T11:00:00.000001+00:00' };
const versions = { rules: 'r1', payee: 'p1', content: 'c1', contact: 'k1', recipients: '2026-10-12T12:00:00.000001+00:00' };
const content: SiteContent = { announcement: L(''), heroTitle: L('BOGA'), heroSubtitle: L(''), aboutTitle: L(''), aboutText: L('') };
const contact: Settings['contact'] = { whatsapp: '+212600000000', email: 'team@example.com', instagram: '', tiktok: '', facebook: '', address: L(''), hours: L('') };

function setup(answer: { error: { message: string } | null } = { error: null }, state: Partial<DbState> = {}) {
  const rpc = vi.fn(async () => ({ data: null, ...answer }));
  const data: AdminData = {
    db: { get: () => ({ version: STATE_VERSION, shippingRates: [oujda], configVersions: versions, ...state }) as unknown as DbState, subscribe: () => () => {} },
    status: { get: () => 'ready', subscribe: () => () => {} },
    reload: vi.fn(),
    refresh: vi.fn(async () => {}),
  };
  return { writes: createConfigWrites(() => ({ rpc }) as unknown as Client, data), rpc, data };
}

beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

describe('settings writes (live site)', () => {
  it('sends each part to its function with its own keys only and the version the page read', async () => {
    const { writes, rpc } = setup();
    const payee = {
      bank: { holder: ' TEST ', bankName: 'TEST', rib: '000000000000000000000000' },
      cashplus: { beneficiary: 'TEST', city: 'Oujda', phone: '0600000000', cin: 'AB123456' },
    } as Payee;
    expect(await writes.savePayee(payee, 'owner')).toBe(true);
    expect(await writes.saveContent(content, null, 'manager')).toBe(true);
    expect(await writes.saveContent(content, contact, 'owner')).toBe(true);
    expect(await writes.saveFreeShipping(300, 'manager')).toBe(true);
    expect(rpc.mock.calls).toEqual([
      // trimmed, and no field outside the form: never an identity card number
      ['save_payee', { p_payee: { bank: { holder: 'TEST', bankName: 'TEST', rib: '000000000000000000000000' }, cashplus: { beneficiary: 'TEST', city: 'Oujda', phone: '0600000000' } }, p_seen: 'p1' }],
      // a manager's save leaves the contact details as they are
      ['save_content', { p_content: content, p_contact: null, p_seen_content: 'c1', p_seen_contact: null }],
      ['save_content', { p_content: content, p_contact: contact, p_seen_content: 'c1', p_seen_contact: 'k1' }],
      // never saved from the panel yet: no version
      ['save_free_shipping', { p_amount: 300, p_seen: null }],
    ]);
  });

  it('a new city is sent hidden, with a free id from its name; an edit and a method carry their version', async () => {
    const { writes, rpc } = setup();
    const created = await writes.createShippingRate({ ...oujda, id: '', active: true, updatedAt: undefined }, 'manager');
    expect(created).toMatchObject({ id: 'oujda-2', active: false });
    expect(rpc).toHaveBeenLastCalledWith('save_shipping_rate', { p_rate: expect.objectContaining({ id: 'oujda-2', active: false }), p_seen: null });
    expect(await writes.saveShippingRate({ ...oujda, baseFee: 25 }, 'manager')).toBe(true);
    expect(rpc).toHaveBeenLastCalledWith('save_shipping_rate', { p_rate: expect.objectContaining({ baseFee: 25 }), p_seen: oujda.updatedAt });
    expect(await writes.savePaymentMethod(method, 'owner')).toBe(true);
    expect(rpc).toHaveBeenLastCalledWith('save_payment_method', { p_method: { id: 'bank_transfer', enabled: true, label: method.label, instructions: method.instructions }, p_seen: method.updatedAt });
  });

  it('every text is sent trimmed, as the database keeps it', async () => {
    const pad = (fr: string) => ({ ar: ` ${fr}`, fr: `${fr}\n `, en: `\t${fr} ` });
    const { writes, rpc } = setup();
    await writes.saveContent({ ...content, heroTitle: pad('BOGA') }, { ...contact, whatsapp: ' +212600000000 ', address: pad('Oujda') }, 'owner');
    expect(rpc).toHaveBeenLastCalledWith('save_content', {
      p_content: { ...content, heroTitle: { ar: 'BOGA', fr: 'BOGA', en: 'BOGA' } },
      p_contact: { ...contact, address: { ar: 'Oujda', fr: 'Oujda', en: 'Oujda' } },
      p_seen_content: 'c1',
      p_seen_contact: 'k1',
    });
    await writes.saveRecipients({ adminWhatsapp: ' +212600000000 ', adminEmail: ' team@example.com\n', whatsappEnabled: true, emailEnabled: true }, 'owner');
    expect(rpc).toHaveBeenLastCalledWith('save_recipients', {
      p_recipients: { adminWhatsapp: '+212600000000', adminEmail: 'team@example.com', whatsappEnabled: true, emailEnabled: true },
      p_seen: versions.recipients,
    });
    await writes.savePaymentMethod({ ...method, label: pad('Virement'), instructions: pad('Merci') }, 'owner');
    expect(rpc).toHaveBeenLastCalledWith('save_payment_method', {
      p_method: { id: 'bank_transfer', enabled: true, label: { ar: 'Virement', fr: 'Virement', en: 'Virement' }, instructions: { ar: 'Merci', fr: 'Merci', en: 'Merci' } },
      p_seen: method.updatedAt,
    });
    await writes.saveShippingRate({ ...oujda, city: pad('Oujda'), deliveryDays: ' 2-3 ' }, 'manager');
    expect(rpc).toHaveBeenLastCalledWith('save_shipping_rate', { p_rate: expect.objectContaining({ city: { ar: 'Oujda', fr: 'Oujda', en: 'Oujda' }, deliveryDays: '2-3' }), p_seen: oujda.updatedAt });
    const created = await writes.createShippingRate({ ...oujda, id: '', city: pad('Nador'), deliveryDays: ' 3 ', updatedAt: undefined }, 'manager');
    expect(created).toMatchObject({ id: 'nador', city: { fr: 'Nador' }, deliveryDays: '3', active: false });
  });

  it('a refusal (an older copy: stale) is "not saved"; no answer is an error; nothing unread is sent', async () => {
    const stale = setup({ error: { message: 'stale' } });
    expect(await stale.writes.saveRules({ ...({} as Settings), customBlend: { enabled: true, minPercent: 5, maxOrigins: 4, feeBySize: { 250: 1, 500: 1, 1000: 1 } } }, 'owner')).toBe(false);
    expect(await stale.writes.createShippingRate({ ...oujda, id: '' }, 'manager')).toBeNull();
    expect(stale.data.refresh).toHaveBeenCalledTimes(2);

    const offline = setup({ error: { message: 'TypeError: Failed to fetch' } });
    await expect(offline.writes.savePayee({ bank: { holder: '', bankName: '', rib: '' }, cashplus: { beneficiary: '', city: '', phone: '' } }, 'owner')).rejects.toThrow(WriteFailed);

    const unread = setup({ error: null }, { configVersions: {} });
    expect(await unread.writes.saveRecipients({ adminWhatsapp: '', adminEmail: '', whatsappEnabled: true, emailEnabled: true }, 'owner')).toBe(false);
    expect(await unread.writes.savePaymentMethod({ ...method, updatedAt: undefined }, 'owner')).toBe(false);
    expect(await unread.writes.saveShippingRate({ ...oujda, updatedAt: undefined }, 'manager')).toBe(false);
    expect(unread.rpc).not.toHaveBeenCalled();
  });
});
