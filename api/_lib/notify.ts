/**
 * Sends each new order, sample request and B2B quote to BOGA CAFÉ:
 *  - by email, through the Gmail account (SMTP with an App Password),
 *  - on WhatsApp, to the owner's own number through CallMeBot (free, owner-only).
 *
 * Recipients are fixed here on the server: the browser only sends the text.
 * Until phase 2 (database), that text is written by the site, so the server
 * accepts nothing else than the site's three messages (checked line by line
 * below), removes links, and marks every message as coming from the website
 * form: a message never proves a payment.
 */

export type Channel = 'sent' | 'skipped' | 'failed';

export interface NotifyEnv {
  /** Gmail address that sends (and, by default, receives) the messages. */
  GMAIL_USER?: string;
  /** 16-character Google App Password (not the account password). */
  GMAIL_APP_PASSWORD?: string;
  /** Where the emails go. Defaults to GMAIL_USER. */
  NOTIFY_EMAIL_TO?: string;
  /** Owner's WhatsApp number in international format, e.g. 212609036378. */
  CALLMEBOT_PHONE?: string;
  /** Key CallMeBot sends back after the one-time activation message. */
  CALLMEBOT_APIKEY?: string;
  /**
   * Website address(es) allowed to call the function, comma separated:
   * https://bogacafe.ma,https://www.bogacafe.ma. Required: without it the
   * function refuses to send anything.
   */
  ALLOWED_ORIGIN?: string;
}

export interface Mail {
  from: string;
  to: string;
  subject: string;
  text: string;
}

export interface NotifyDeps {
  sendMail: (mail: Mail) => Promise<void>;
  fetch: typeof fetch;
  now: () => number;
}

export type NotifyEvent = 'order.created' | 'sample.created' | 'quote.created';

export interface NotifyPayload {
  event: NotifyEvent;
  ref: string;
  subject: string;
  whatsapp: string;
  email: string;
}

/** What each message of the site looks like (src/services/notifications/templates.ts). */
const SHAPE: Record<NotifyEvent, { prefix: string; firstLine: (ref: string) => string; subject: (ref: string) => string }> = {
  'order.created': {
    prefix: 'BC',
    firstLine: (ref) => `Nouvelle commande ${ref}`,
    subject: (ref) => `[BOGA CAFÉ] Commande ${ref} - `,
  },
  'sample.created': {
    prefix: 'SR',
    firstLine: (ref) => `Demande d'échantillon ${ref}`,
    subject: (ref) => `[BOGA CAFÉ] Échantillon B2B ${ref} - `,
  },
  'quote.created': {
    prefix: 'QR',
    firstLine: (ref) => `Commande B2B (+10 kg) ${ref}`,
    subject: (ref) => `[BOGA CAFÉ] Demande B2B ${ref} - `,
  },
};

export const LIMITS = { body: 20_000, subject: 200, whatsapp: 4_000, email: 12_000 };

const FOOTER = 'Envoyé par le formulaire du site. Un message ne prouve jamais un paiement : vérifiez-le à la banque ou au CMI.';

/** Links have no place in these messages: a forged one could carry phishing. */
const stripLinks = (text: string) => text.replace(/\b(?:https?:\/\/|www\.)\S+/gi, '[lien retiré]');

/** Parses and checks the request body. Returns an error code or the payload. */
export function parsePayload(raw: unknown): NotifyPayload | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'body' };
  const p = raw as Record<string, unknown>;
  const event = p.event;
  if (typeof event !== 'string' || !Object.hasOwn(SHAPE, event)) return { error: 'event' };
  const shape = SHAPE[event as NotifyEvent];
  const ref = typeof p.ref === 'string' ? p.ref : '';
  // random codes for new requests (BC-2026-7K4M2Q), digits for the database sequence
  if (!new RegExp(`^${shape.prefix}-\\d{4}-[0-9A-Z]{4,8}$`).test(ref)) return { error: 'ref' };
  const str = (k: string, max: number) => (typeof p[k] === 'string' && p[k].trim() && p[k].length <= max ? p[k] : null);
  const subject = str('subject', LIMITS.subject);
  const whatsapp = str('whatsapp', LIMITS.whatsapp);
  const email = str('email', LIMITS.email);
  if (!subject || !whatsapp || !email) return { error: 'text' };
  const first = (t: string) => t.split('\n', 1)[0];
  if (!subject.startsWith(shape.subject(ref)) || first(whatsapp) !== shape.firstLine(ref) || first(email) !== shape.firstLine(ref)) {
    return { error: 'shape' };
  }
  return {
    event: event as NotifyEvent,
    ref,
    subject: stripLinks(subject).replace(/[\r\n]+/g, ' '),
    whatsapp: stripLinks(whatsapp),
    email: stripLinks(email),
  };
}

/** Same message → same key: a retry or a double click is not sent twice. */
async function messageKey(p: NotifyPayload): Promise<string> {
  const data = new TextEncoder().encode(`${p.event}\n${p.ref}\n${p.whatsapp}`);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Best-effort limits per server instance: a burst from one address, a burst in
 * total (protects the Gmail daily quota), and a message already delivered.
 * A message is remembered only once delivered, so a failed attempt can be retried.
 */
export class Guard {
  private hits = new Map<string, number[]>();
  private all: number[] = [];
  private delivered = new Map<string, number>();
  constructor(
    private perIp = 6,
    private total = 60,
    private windowMs = 10 * 60_000,
    private rememberMs = 24 * 3600_000,
  ) {}

  allow(ip: string, key: string, now: number): 'ok' | 'rate' | 'duplicate' {
    this.prune(now);
    const last = this.delivered.get(key);
    if (last !== undefined) return 'duplicate';
    const recent = this.hits.get(ip) ?? [];
    if (recent.length >= this.perIp || this.all.length >= this.total) return 'rate';
    recent.push(now);
    this.hits.set(ip, recent);
    this.all.push(now);
    return 'ok';
  }

  markDelivered(key: string, now: number) {
    this.delivered.set(key, now);
  }

  /** Forget what is out of the windows, so memory stays bounded. */
  private prune(now: number) {
    this.all = this.all.filter((t) => now - t < this.windowMs);
    for (const [ip, times] of this.hits) {
      const keep = times.filter((t) => now - t < this.windowMs);
      if (keep.length) this.hits.set(ip, keep);
      else this.hits.delete(ip);
    }
    for (const [key, at] of this.delivered) if (now - at >= this.rememberMs) this.delivered.delete(key);
  }

  size() {
    return { ips: this.hits.size, delivered: this.delivered.size };
  }
}

async function sendWhatsapp(p: NotifyPayload, env: NotifyEnv, deps: NotifyDeps): Promise<Channel> {
  if (!env.CALLMEBOT_PHONE || !env.CALLMEBOT_APIKEY) return 'skipped';
  const url = new URL('https://api.callmebot.com/whatsapp.php');
  url.searchParams.set('phone', env.CALLMEBOT_PHONE.replace(/\D/g, ''));
  url.searchParams.set('text', `🔔 BOGA CAFÉ · site\n${p.whatsapp}\n\n${FOOTER}`);
  url.searchParams.set('apikey', env.CALLMEBOT_APIKEY);
  try {
    const res = await deps.fetch(url, { signal: AbortSignal.timeout(6_000) });
    const text = await res.text();
    // CallMeBot answers 200 with an explanation page when the key or number is
    // wrong: only its confirmation counts as sent
    if (!res.ok || !/queued|message sent/i.test(text) || /apikey is invalid|error/i.test(text)) {
      console.error('whatsapp: callmebot did not confirm', res.status);
      return 'failed';
    }
    return 'sent';
  } catch (e) {
    console.error('whatsapp: request failed', (e as Error).name);
    return 'failed';
  }
}

async function sendEmail(p: NotifyPayload, env: NotifyEnv, deps: NotifyDeps): Promise<Channel> {
  if (!env.GMAIL_USER || !env.GMAIL_APP_PASSWORD) return 'skipped';
  try {
    await deps.sendMail({
      from: `"BOGA CAFÉ · site" <${env.GMAIL_USER}>`,
      to: env.NOTIFY_EMAIL_TO || env.GMAIL_USER,
      subject: p.subject,
      text: `${p.email}\n\n— ${FOOTER}`,
    });
    return 'sent';
  } catch (e) {
    console.error('email: gmail refused', (e as Error).name);
    return 'failed';
  }
}

const allowedOrigins = (env: NotifyEnv) =>
  (env.ALLOWED_ORIGIN ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);

function clientIp(request: Request): string {
  const h = request.headers;
  // Vercel sets these itself; the first x-forwarded-for entry is the fallback elsewhere
  return (
    h.get('x-real-ip') ||
    h.get('x-vercel-forwarded-for')?.split(',')[0].trim() ||
    h.get('x-forwarded-for')?.split(',')[0].trim() ||
    'unknown'
  );
}

const json = (status: number, body: unknown, origin?: string) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
    },
  });

/** Browser pre-flight for a site hosted on another address than the function. */
export function handlePreflight(request: Request, env: NotifyEnv): Response {
  const origin = (request.headers.get('origin') ?? '').replace(/\/+$/, '');
  if (!allowedOrigins(env).includes(origin)) return new Response(null, { status: 403 });
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    },
  });
}

export async function handleNotify(request: Request, env: NotifyEnv, deps: NotifyDeps, guard: Guard): Promise<Response> {
  const origins = allowedOrigins(env);
  if (!origins.length) return json(503, { error: 'not_configured' });
  const origin = (request.headers.get('origin') ?? '').replace(/\/+$/, '');
  // browsers always send Origin on a POST from a page: no Origin = not our website
  if (!origins.includes(origin)) return json(403, { error: 'origin' });
  if (request.method !== 'POST') return json(405, { error: 'method' }, origin);
  // JSON only: a plain HTML form or a "simple" cross-site request cannot reach this point
  if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    return json(415, { error: 'content_type' }, origin);
  }

  const raw = await request.text();
  if (raw.length > LIMITS.body) return json(413, { error: 'size' }, origin);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { error: 'json' }, origin);
  }
  const payload = parsePayload(body);
  if ('error' in payload) return json(400, payload, origin);

  const key = await messageKey(payload);
  const verdict = guard.allow(clientIp(request), key, deps.now());
  if (verdict === 'rate') return json(429, { error: 'rate' }, origin);
  if (verdict === 'duplicate') return json(200, { whatsapp: 'skipped', email: 'skipped', duplicate: true }, origin);

  const [whatsapp, email] = await Promise.all([sendWhatsapp(payload, env, deps), sendEmail(payload, env, deps)]);
  const ok = whatsapp === 'sent' || email === 'sent';
  if (ok) guard.markDelivered(key, deps.now());
  const nothingConfigured = whatsapp === 'skipped' && email === 'skipped';
  return json(ok ? 200 : nothingConfigured ? 503 : 502, { whatsapp, email }, origin);
}
