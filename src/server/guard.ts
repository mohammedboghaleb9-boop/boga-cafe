/**
 * Protection of the public forms against floods and fake orders that would
 * hold the stock (an unpaid order reserves it for 48 h):
 *  - a limit per phone number and per connection (IP, stored hashed), counted
 *    in the database (rate_limit_hit), only for requests that passed every check;
 *  - Cloudflare Turnstile, when TURNSTILE_SECRET_KEY is set on the server.
 */
import type { Client } from '@/data/supabase/client';

export type Route = 'order' | 'quote';

/** [max accepted requests, window in seconds]. Mobile networks share IPs, so the IP limits are wide. */
export const LIMITS: Record<Route, { phone: [number, number]; ip: [number, number] }> = {
  order: { phone: [5, 3600], ip: [30, 3600] },
  quote: { phone: [3, 86_400], ip: [20, 86_400] },
};

/** Same IP → same text, but the IP itself is never stored. */
export async function hashIp(ip: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`boga-cafe:${ip}`));
  return [...new Uint8Array(digest)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** true when both the phone and the connection are under their limit (and counts this request). */
export async function withinLimits(db: Client, route: Route, phone: string, ip: string | null): Promise<boolean> {
  const buckets: [string, [number, number]][] = [[`${route}:phone:${phone}`, LIMITS[route].phone]];
  if (ip) buckets.push([`${route}:ip:${await hashIp(ip)}`, LIMITS[route].ip]);
  for (const [bucket, [limit, seconds]] of buckets) {
    const { data, error } = await db.rpc('rate_limit_hit', { p_bucket: bucket, p_limit: limit, p_window_seconds: seconds });
    if (error) throw error;
    if (!data) return false;
  }
  return true;
}

/** Cloudflare's answer for a widget token. Fails closed: no answer = not verified. */
export async function verifyTurnstile(secret: string, token: string, ip: string | null, fetchFn: typeof fetch = fetch): Promise<boolean> {
  if (!token) return false;
  const body = new URLSearchParams({ secret, response: token });
  if (ip) body.set('remoteip', ip);
  try {
    const res = await fetchFn('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch (e) {
    console.error('turnstile', e);
    return false;
  }
}
