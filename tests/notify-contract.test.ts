/**
 * Every message the site sends is one the notification server accepts (audit M2).
 * The server checks each message's first line and subject (api/_lib/notify.ts
 * SHAPE); a template that drifts from it would make automatic notifications fail
 * silently, with the customer only seeing the manual fallback.
 */
import { describe, expect, it } from 'vitest';
import { parsePayload } from '../api/_lib/notify';
import { templateContext } from '../src/data/context';
import { initialState } from '../src/data/demo/store';
import { orderMessage, paymentReportMessage, quoteMessage } from '../src/services/notifications';

describe('site messages and the notification server agree', () => {
  it('accepts every kind of message the site builds', () => {
    const s = initialState(true);
    const ctx = templateContext(s);
    const order = s.orders[0];
    const sent = [
      { event: 'order.created', ref: order.number, ...orderMessage(order, ctx) },
      { event: 'payment.reported', ref: order.number, ...paymentReportMessage({ ...order, paymentRef: 'REF-1' }, ctx) },
      { event: 'quote.created', ref: s.quotes[0].number, ...quoteMessage(s.quotes[0], ctx) },
    ];
    for (const p of sent) expect(parsePayload(p), p.event).not.toHaveProperty('error');
  });
});
