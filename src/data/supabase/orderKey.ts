/**
 * The idempotency key sent with an order (slice 3b): the same key while the
 * customer sends the same submission again (its answer was lost, the page was
 * reloaded), a new one as soon as anything in it changes, and a new one once an
 * order went through (the same cart ordered twice on purpose is two orders).
 * Kept for the tab (sessionStorage) with a hash of the submission, not the
 * submission itself, for a day at most: an unpaid order is cancelled after 48 h,
 * and a tab restored days later must place a new order, not get the old one.
 */
import type { CheckoutInput } from '@/core/order';

const KEY = 'boga.orderAttempt';
const KEEP_MS = 24 * 3_600_000;

type Attempt = { hash: string; key: string; at: number };

/** Used when the tab cannot store anything (private mode): the key still holds until a reload. */
let memory: Attempt | null = null;

async function hashOf(input: CheckoutInput): Promise<string> {
  // the language is not part of what is ordered
  const what = JSON.stringify([input.items, input.customer, input.paymentMethod]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(what));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function last(): Attempt | null {
  try {
    const a = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as Partial<Attempt> | null;
    if (a && typeof a.hash === 'string' && typeof a.key === 'string' && typeof a.at === 'number') return a as Attempt;
  } catch {
    // unreadable or no storage: fall back to memory
  }
  return memory;
}

/** The key of this submission: the last one when it is the same submission again. */
export async function orderKey(input: CheckoutInput): Promise<string> {
  const hash = await hashOf(input);
  const prev = last();
  if (prev?.hash === hash && Date.now() - prev.at < KEEP_MS) return prev.key;
  memory = { hash, key: crypto.randomUUID(), at: Date.now() };
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
