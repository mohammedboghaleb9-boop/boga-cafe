/**
 * The site's side of the storefront Edge Function (src/server/storefront.ts):
 * POST …/functions/v1/storefront/{order|quote} with the publishable key.
 * Any answer the forms cannot act on (no answer, 4xx, 5xx, an unreadable body)
 * becomes the one error 'server'; refusals the customer can fix come back as
 * the server sent them, 'too_many' and 'captcha' included.
 */
import type { GuardError } from '../types';

export type StorefrontRoute = 'order' | 'quote';
export type StorefrontReply<T> = ({ ok: true } & T) | { ok: false; errors: string[] };

/**
 * Long enough for the server's own checks (Turnstile up to 5 s, the database);
 * an answer lost after the order was saved shows 'server' (the text says so).
 */
const POST_TIMEOUT_MS = 30_000;

const SERVER: { ok: false; errors: GuardError[] } = { ok: false, errors: ['server'] };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** What the forms get from the server's status and body (pure, unit tested). */
export function readReply<T>(status: number, body: unknown, payload: keyof T & string): StorefrontReply<T> {
  if (status !== 200 || !isObject(body)) return SERVER;
  if (body.ok === true && isObject(body[payload])) return body as { ok: true } & T;
  if (body.ok === false && Array.isArray(body.errors) && body.errors.length > 0 && body.errors.every((e) => typeof e === 'string')) {
    return { ok: false, errors: body.errors as string[] };
  }
  return SERVER;
}

export interface StorefrontTarget {
  url: string;
  key: string;
  fetchFn?: typeof fetch;
}

/** Sends one form; never rejects (a network failure is 'server'). */
export async function postStorefront<T>(
  route: StorefrontRoute,
  body: unknown,
  payload: keyof T & string,
  { url, key, fetchFn = fetch }: StorefrontTarget,
): Promise<StorefrontReply<T>> {
  try {
    // a URL pasted with a trailing slash would give …co//functions (the catalog works, every order fails)
    const res = await fetchFn(`${url.replace(/\/+$/, '')}/functions/v1/storefront/${route}`, {
      method: 'POST',
      headers: { apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(POST_TIMEOUT_MS),
    });
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      // not JSON (a proxy's error page): 'server'
    }
    return readReply<T>(res.status, parsed, payload);
  } catch (e) {
    console.error(`storefront/${route}:`, e);
    return SERVER;
  }
}
