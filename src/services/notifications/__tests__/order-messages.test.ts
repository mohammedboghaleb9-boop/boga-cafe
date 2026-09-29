/**
 * Order and payment-report messages (review after the merge): WhatsApp may be
 * the only message the team reads, so it carries the address and the notes,
 * and the payment line says where the money really stands.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Order } from '@/core/types';
import { parsePayload } from '../../../../api/_lib/notify';

async function demo() {
  vi.resetModules();
  const [{ db }, { templateContext }, templates] = await Promise.all([
    import('@/data/store'),
    import('@/data/context'),
    import('../templates'),
  ]);
  const s = db.get();
  const order: Order = {
    ...s.orders[0],
    customer: { ...s.orders[0].customer, address: '12 rue Test, quartier Al Qods', email: 'client@example.com', notes: 'Sonner deux fois' },
  };
  return { order, ctx: templateContext(s), ...templates };
}

describe('order messages', () => {
  it('put the delivery address, email and notes in the WhatsApp message too', async () => {
    const { order, ctx, orderMessage } = await demo();
    const m = orderMessage(order, ctx);
    for (const text of [m.whatsapp, m.email]) {
      expect(text).toContain('Adresse : 12 rue Test, quartier Al Qods');
      expect(text).toContain('Email : client@example.com');
      expect(text).toContain('Note : Sonner deux fois');
    }
    expect(m.email.match(/Adresse :/g)).toHaveLength(1);
  });

  it('say where the payment stands instead of always "en attente"', async () => {
    const { order, ctx, orderMessage } = await demo();
    const line = (paymentStatus: Order['paymentStatus']) =>
      orderMessage({ ...order, paymentStatus }, ctx).whatsapp.split('\n').find((l) => l.startsWith('Paiement :'));
    expect(line('pending')).toMatch(/\(en attente\)$/);
    expect(line('paid')).toMatch(/\(payé\)$/);
    expect(line('awaiting_verification')).toMatch(/\(signalé par le client, à vérifier\)$/);
    expect(line('refunded')).toMatch(/\(remboursé\)$/);
  });
});

describe('payment report message', () => {
  it('carries the reference, the amount and the whole order, and the server accepts it', async () => {
    const { order, ctx, paymentReportMessage } = await demo();
    const reported = { ...order, paymentStatus: 'awaiting_verification' as const, paymentRef: 'CP-778812' };
    const m = paymentReportMessage(reported, ctx);
    expect(m.whatsapp.split('\n')[0]).toBe(`Paiement signalé ${order.number}`);
    expect(m.whatsapp).toContain('Référence donnée par le client : CP-778812');
    expect(m.whatsapp).toContain('Adresse : 12 rue Test');
    expect(m.whatsapp).toContain(order.lines[0].name.fr);
    expect(m.subject.startsWith(`[BOGA CAFÉ] Paiement signalé ${order.number} - `)).toBe(true);
    expect(parsePayload({ event: 'payment.reported', ref: order.number, ...m })).not.toHaveProperty('error');
  });
});

describe('what the order page asks the customer to send', () => {
  it('the order, then the payment report once "I have paid" is pressed, nothing once closed', async () => {
    const { order, ctx, orderHandoff } = await demo();
    expect(orderHandoff({ ...order, status: 'new', paymentStatus: 'pending' }, ctx)?.event).toBe('order.created');
    const reported = orderHandoff({ ...order, status: 'new', paymentStatus: 'awaiting_verification', paymentRef: 'CP-1' }, ctx);
    expect(reported?.event).toBe('payment.reported');
    expect(reported?.draft.whatsapp.split('\n')[0]).toBe(`Paiement signalé ${order.number}`);
    expect(orderHandoff({ ...order, status: 'confirmed', paymentStatus: 'paid' }, ctx)?.event).toBe('order.created');
    expect(orderHandoff({ ...order, status: 'cancelled' }, ctx)).toBeNull();
    expect(orderHandoff({ ...order, status: 'delivered' }, ctx)).toBeNull();
  });
});
