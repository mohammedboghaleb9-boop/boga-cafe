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
 * customer moves on at once, and the page follows the delivery status through
 * `deliveryStatus` / `onDeliveryChange`:
 *   'pending' → 'sent' | 'failed', with 'slow' in between when the server takes
 *   longer than PATIENCE_MS (Gmail can need up to ~17 s: api/notify.ts timeouts).
 * The last known status of each request is kept for the tab (sessionStorage),
 * so a reload of the confirmation page does not forget a confirmed delivery.
 */
import type { NotificationEvent } from '@/core/types';
import type { MessageDraft } from './templates';

export type DeliverableEvent = Extract<NotificationEvent, 'order.created' | 'sample.created' | 'quote.created'>;
export type DeliveryStatus = 'off' | 'pending' | 'slow' | 'sent' | 'failed';

export const notifyUrl: string = import.meta.env.VITE_NOTIFY_URL ?? '';

/** After this, the page shows the manual step too; the request goes on and can still end 'sent'. */
const PATIENCE_MS = 9_000;

const STORE_KEY = 'boga.delivery';
const statuses = new Map<string, DeliveryStatus>(readStored());
const listeners = new Set<() => void>();

function readStored(): [string, DeliveryStatus][] {
  try {
    const raw = JSON.parse(sessionStorage.getItem(STORE_KEY) ?? '{}') as Record<string, unknown>;
    return Object.entries(raw).flatMap(([ref, s]): [string, DeliveryStatus][] =>
      // an answer that never came back before the reload is unknown: show the manual step
      s === 'sent' || s === 'failed' ? [[ref, s]] : s === 'pending' || s === 'slow' ? [[ref, 'slow']] : [],
    );
  } catch {
    return [];
  }
}

function setStatus(ref: string, status: DeliveryStatus) {
  statuses.set(ref, status);
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(Object.fromEntries([...statuses].slice(-20))));
  } catch {
    // private mode or storage full: the status still works for this page
  }
  listeners.forEach((l) => l());
}

export const deliveryStatus = (ref: string): DeliveryStatus => statuses.get(ref) ?? 'off';

// While the page is being left (reload, card payment page), the browser cuts the
// requests of this page: that is not an answer from the server, so it is not
// recorded, and the reloaded page shows 'slow' (unknown) instead of 'failed'.
let leaving = false;
globalThis.addEventListener?.('pagehide', () => (leaving = true));
globalThis.addEventListener?.('pageshow', () => (leaving = false));

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
    if (!settled) setStatus(ref, 'slow'); // show the manual step meanwhile; the answer can still come
  }, PATIENCE_MS);
  void post(event, ref, draft).then((ok) => {
    settled = true;
    clearTimeout(timer);
    if (!ok && leaving) return;
    setStatus(ref, ok ? 'sent' : 'failed');
  });
}
