/**
 * Real delivery of the administration messages (WhatsApp + Gmail).
 *
 * When the site is deployed with the notification function (api/notify.ts),
 * VITE_NOTIFY_URL points to it and every new order, sample request and B2B
 * quote is sent automatically, whatever the customer does next.
 * Without it (the clickable prototype), nothing leaves the browser and the
 * customer's "send on WhatsApp / Gmail" step is the delivery.
 *
 * The request is never awaited by the order itself: the order is saved and the
 * customer moves on at once, and the page follows the delivery status
 * ('pending' → 'sent' | 'failed') through `deliveryStatus` / `onDeliveryChange`.
 */
import type { NotificationEvent } from '@/core/types';
import type { MessageDraft } from './templates';

export type DeliverableEvent = Extract<NotificationEvent, 'order.created' | 'sample.created' | 'quote.created'>;
export type DeliveryStatus = 'off' | 'pending' | 'sent' | 'failed';

export const notifyUrl: string = import.meta.env.VITE_NOTIFY_URL ?? '';

/** After this, the page stops waiting and shows the manual step (the request itself goes on). */
const PATIENCE_MS = 9_000;

const statuses = new Map<string, DeliveryStatus>();
const listeners = new Set<() => void>();

function setStatus(ref: string, status: DeliveryStatus) {
  statuses.set(ref, status);
  listeners.forEach((l) => l());
}

export const deliveryStatus = (ref: string): DeliveryStatus => statuses.get(ref) ?? 'off';

export function onDeliveryChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** true only when the server confirms at least one channel (WhatsApp or email) was delivered. */
async function post(event: DeliverableEvent, ref: string, draft: MessageDraft): Promise<boolean> {
  try {
    const res = await fetch(notifyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, ref, ...draft }),
      // keeps going if the customer leaves the page (e.g. to the card payment page)
      keepalive: true,
    });
    if (!res.ok) return false;
    const result = (await res.json()) as { whatsapp?: string; email?: string; duplicate?: boolean };
    return result.whatsapp === 'sent' || result.email === 'sent' || result.duplicate === true;
  } catch {
    return false;
  }
}

/** Starts the delivery and returns at once. */
export function deliver(event: DeliverableEvent, ref: string, draft: MessageDraft): void {
  if (!notifyUrl) return;
  setStatus(ref, 'pending');
  let settled = false;
  const timer = setTimeout(() => {
    if (!settled) setStatus(ref, 'failed'); // too slow: ask the customer to send it too
  }, PATIENCE_MS);
  void post(event, ref, draft).then((ok) => {
    settled = true;
    clearTimeout(timer);
    setStatus(ref, ok ? 'sent' : 'failed');
  });
}
