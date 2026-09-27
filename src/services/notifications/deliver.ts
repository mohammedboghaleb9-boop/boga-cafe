/**
 * Real delivery of the administration messages (WhatsApp + Gmail).
 *
 * When the site is deployed with the notification function (api/notify.ts),
 * VITE_NOTIFY_URL points to it and every new order, sample request and B2B
 * quote is sent automatically, whatever the customer does next.
 * Without it (the clickable prototype), nothing leaves the browser and the
 * customer's "send on WhatsApp / Gmail" step is the delivery.
 */
import type { NotificationEvent } from '@/core/types';
import type { MessageDraft } from './templates';

export type DeliverableEvent = Extract<NotificationEvent, 'order.created' | 'sample.created' | 'quote.created'>;

export const notifyUrl: string = import.meta.env.VITE_NOTIFY_URL ?? '';

/** Longest the customer waits for the confirmation; the request itself keeps going. */
const WAIT_MS = 8000;

/**
 * Sends the message to the notification function.
 * Resolves true only when the server confirms at least one channel (WhatsApp or
 * email) was delivered, so the site never tells a customer "we got it" by mistake.
 */
export async function deliver(event: DeliverableEvent, ref: string, draft: MessageDraft): Promise<boolean> {
  if (!notifyUrl) return false;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), WAIT_MS);
  try {
    const res = await fetch(notifyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, ref, ...draft }),
      keepalive: true,
      signal: abort.signal,
    });
    if (!res.ok) return false;
    const result = (await res.json()) as { whatsapp?: string; email?: string };
    return result.whatsapp === 'sent' || result.email === 'sent';
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
