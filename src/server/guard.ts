/**
 * Protection of the public forms against floods and fake orders that would
 * hold the stock (an unpaid order reserves it for 48 h). What it does:
 *  - every request that reaches the server costs from a per-connection budget,
 *    before the catalog is even read;
 *  - accepted requests are counted per phone number and per connection, by the
 *    hour and by the day (rate_limit_hit);
 *  - Cloudflare Turnstile, when TURNSTILE_SECRET_KEY is set on the server.
 * What it does not do: stop someone with many phone numbers and many connections.
 * Turnstile is what makes that expensive, so set its keys before the site takes
 * orders; the 48 h expiry bounds the damage meanwhile.
 * No cap on open unpaid orders per phone: phone numbers are not verified, so a cap
 * would let anyone lock a real customer out for 48 h with two cheap orders, unseen;
 * a fake order is visible and the owner frees its stock by cancelling it.
 * The IP is never stored: buckets carry a keyed hash of it (HMAC with a server secret),
 * an IPv6 address counted by its /64 network (what one host can use freely).
 */
import type { Client } from '@/data/supabase/client';

export type Route = 'order' | 'quote';
type Limit = [max: number, windowSeconds: number];

/** Mobile networks share IPs, so the per-connection limits are wider than the per-phone ones. */
export const LIMITS: Record<Route, { phone: Limit[]; ip: Limit[] }> = {
  order: { phone: [[5, 3600]], ip: [[10, 3600], [20, 86_400]] },
  quote: { phone: [[3, 86_400]], ip: [[20, 86_400]] },
};
/** Any request that parses, accepted or not: it costs a catalog read. */
export const REQUEST_BUDGET: Limit = [120, 3600];

/**
 * What one visitor controls: an IPv4 address, or the /64 network of an IPv6 address
 * (a single host gets a whole /64 and can rotate through it).
 */
export function ipBucket(ip: string): string {
  if (!ip.includes(':')) return ip;
  const [head, tail = ''] = ip.toLowerCase().split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left;
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

/** Same visitor → same text; without the key the text says nothing about the IP. */
export async function hashIp(ip: string, key: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(`boga-cafe:${key}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(ipBucket(ip)));
  return [...new Uint8Array(mac)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hit(db: Client, bucket: string, [limit, seconds]: Limit): Promise<boolean> {
  const { data, error } = await db.rpc('rate_limit_hit', { p_bucket: bucket, p_limit: limit, p_window_seconds: seconds });
  if (error) throw error;
  return data === true;
}

/** false once this connection sent too many requests (counted whatever their fate). */
export async function withinBudget(db: Client, ip: string | null, ipKey: string): Promise<boolean> {
  return !ip || hit(db, `req:ip:${await hashIp(ip, ipKey)}`, REQUEST_BUDGET);
}

/** true when the phone and the connection are under all their limits (and counts this request). */
export async function withinLimits(db: Client, route: Route, phone: string, ip: string | null, ipKey: string): Promise<boolean> {
  const buckets: [string, Limit][] = LIMITS[route].phone.map((l) => [`${route}:phone:${l[1]}:${phone}`, l]);
  if (ip) {
    const h = await hashIp(ip, ipKey);
    buckets.push(...LIMITS[route].ip.map((l): [string, Limit] => [`${route}:ip:${l[1]}:${h}`, l]));
  }
  for (const [bucket, limit] of buckets) if (!(await hit(db, bucket, limit))) return false;
  return true;
}

/** Cloudflare's answer for a widget token. Fails closed: no answer in 5 s = not verified. */
export async function verifyTurnstile(secret: string, token: string, ip: string | null, fetchFn: typeof fetch = fetch): Promise<boolean> {
  if (!token) return false;
  const body = new URLSearchParams({ secret, response: token });
  if (ip) body.set('remoteip', ip);
  try {
    const res = await fetchFn('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body, signal: AbortSignal.timeout(5000) });
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch (e) {
    console.error('turnstile', e);
    return false;
  }
}
