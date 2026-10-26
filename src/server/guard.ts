/**
 * Protection of the public forms against floods and fake orders that would
 * hold the stock (an unpaid order reserves it for 48 h). What it does:
 *  - every request that passes Turnstile costs from a per-connection budget,
 *    before the catalog is even read;
 *  - accepted requests are counted per phone number and per connection, by the
 *    hour and by the day (rate_limit_hit);
 *  - Cloudflare Turnstile on every form, checked first (storefront.ts).
 * What it does not do: stop someone with many phone numbers and many connections.
 * Turnstile is what makes that expensive; the 48 h expiry bounds the damage of what gets through.
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
/** Any request past Turnstile, accepted or not: it costs a catalog read. */
const REQUEST_BUDGET: Limit = [120, 3600];

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

/** Cloudflare's test secrets (always passes, always fails, token already spent). */
const TEST_SECRET = /^[123]x0+AA$/;

/**
 * The secret the live function may use: a test secret there would accept the public
 * dummy token from anyone, so it counts as no secret (every form refused, logged).
 */
export function liveTurnstileSecret(secret: string): string {
  if (!TEST_SECRET.test(secret)) return secret;
  console.error('storefront: TURNSTILE_SECRET_KEY is a Cloudflare test secret; refusing every form');
  return '';
}

const LABEL = '[a-z0-9]([a-z0-9-]*[a-z0-9])?';
/** A hostname the site may be served from: lower case labels of letters, digits and dashes. */
const HOSTNAME = new RegExp(`^${LABEL}(\\.${LABEL})*$`);
/** A wildcard entry: `*-` and a label, then at least three more labels, so the star only stands for the start of the first one. */
const WILDCARD = new RegExp(`^\\*-${LABEL}(\\.${LABEL}){3,}$`);

/**
 * The hostnames a Turnstile token may come from (TURNSTILE_HOSTNAMES, comma separated): the site's
 * own address, and for the previews one wildcard such as `*-boga-cafe.<account>.workers.dev`: the star
 * is glued to a dash and stands for one label start (a version id or a branch alias), and the entry
 * must name the account, whose workers.dev names only its owner can create. `*.workers.dev` and
 * anything shorter is dropped, so a typo never widens what is accepted. A dropped entry is logged by
 * its place and length, never its text (a secret pasted here by mistake must not reach the logs).
 */
export function liveTurnstileHostnames(raw: string): string[] {
  const kept: string[] = [];
  raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .forEach((entry, i) => {
      if (HOSTNAME.test(entry) || WILDCARD.test(entry)) kept.push(entry);
      else console.error(`storefront: TURNSTILE_HOSTNAMES entry ${i + 1} (${entry.length} characters) is not a hostname or a safe wildcard: ignored`);
    });
  return kept;
}

/**
 * Whether `hostname` is one of `allowed` (liveTurnstileHostnames' output): exactly, or under a wildcard
 * entry's suffix with one label start before it (letters, digits, dashes), never the suffix alone.
 */
export function hostnameAllowed(hostname: string, allowed: string[]): boolean {
  const host = hostname.toLowerCase();
  return allowed.some((entry) => {
    if (!entry.startsWith('*')) return host === entry;
    const suffix = entry.slice(1);
    return host.endsWith(suffix) && /^[a-z0-9-]+$/.test(host.slice(0, host.length - suffix.length));
  });
}

/** What a token must prove besides being valid: it was solved for this form, on one of the site's own pages. */
interface TurnstileExpectation {
  action: Route;
  hostnames: string[];
}

/**
 * Cloudflare's answer for a widget token (developers.cloudflare.com/turnstile/get-started/server-side-validation):
 * valid, solved for the expected `action` (the widget names the form), on an allowed `hostname`.
 * Fails closed: no answer in 5 s = not verified.
 */
export async function verifyTurnstile(
  secret: string,
  token: string,
  ip: string | null,
  expected: TurnstileExpectation,
  fetchFn: typeof fetch = fetch,
): Promise<boolean> {
  if (!token) return false;
  const body = new URLSearchParams({ secret, response: token });
  if (ip) body.set('remoteip', ip);
  try {
    const res = await fetchFn('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body, signal: AbortSignal.timeout(5000) });
    const data = (await res.json()) as { success?: boolean; action?: string; hostname?: string };
    if (data.success !== true) return false;
    if (data.action !== expected.action) {
      console.error(`turnstile: token solved for action ${JSON.stringify(data.action)}, expected ${JSON.stringify(expected.action)}`);
      return false;
    }
    if (typeof data.hostname !== 'string' || !hostnameAllowed(data.hostname, expected.hostnames)) {
      console.error(`turnstile: token solved on hostname ${JSON.stringify(data.hostname)}, not an allowed one`);
      return false;
    }
    return true;
  } catch (e) {
    console.error('turnstile', e);
    return false;
  }
}
