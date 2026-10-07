/**
 * The idempotency key sent with an order (slice 3b): the same key while the
 * customer sends the same submission again (its answer was lost, the page was
 * reloaded), a new one as soon as anything in it changes, and a new one once an
 * order went through (the same cart ordered twice on purpose is two orders).
 * Kept for the tab (sessionStorage) with a hash of the submission, not the
 * submission itself.
 */
import type { CheckoutInput } from '@/core/order';

const KEY = 'boga.orderAttempt';

/** Used when the tab cannot store anything (private mode): the key still holds until a reload. */
let memory: { hash: string; key: string } | null = null;

async function hashOf(input: CheckoutInput): Promise<string> {
  // the language is not part of what is ordered
  const what = JSON.stringify([input.items, input.customer, input.paymentMethod]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(what));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function last(): { hash: string; key: string } | null {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(KEY) ?? 'null');
    if (parsed && typeof (parsed as { hash?: unknown }).hash === 'string' && typeof (parsed as { key?: unknown }).key === 'string') {
      return parsed as { hash: string; key: string };
    }
  } catch {
    // unreadable or no storage: fall back to memory
  }
  return memory;
}

/** The key of this submission: the last one when it is the same submission again. */
export async function orderKey(input: CheckoutInput): Promise<string> {
  const hash = await hashOf(input);
  const prev = last();
  if (prev?.hash === hash) return prev.key;
  memory = { hash, key: crypto.randomUUID() };
  try {
    sessionStorage.setItem(KEY, JSON.stringify(memory));
  } catch {
    // kept in memory only
  }
  return memory.key;
}

/** The order went through: the next submission, even an identical one, is a new order. */
export function orderSent() {
  memory = null;
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // nothing stored
  }
}
