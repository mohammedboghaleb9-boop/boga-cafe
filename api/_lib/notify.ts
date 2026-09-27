/**
 * Sends each new order, sample request and B2B quote to BOGA CAFÉ:
 *  - by email, through the Gmail account (SMTP with an App Password),
 *  - on WhatsApp, to the owner's own number through CallMeBot (free, owner-only).
 *
 * The recipients are fixed here on the server: the browser only sends the text.
 * Until phase 2 (database), the text is written by the site; the checks below
 * keep the endpoint from being used for anything else than those three messages.
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
  /** e.g. https://bogacafe.ma — requests from other sites are refused. */
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

export interface NotifyPayload {
  event: 'order.created' | 'sample.created' | 'quote.created';
  ref: string;
  subject: string;
  whatsapp: string;
  email: string;
}

const PREFIX: Record<NotifyPayload['event'], string> = {
  'order.created': 'BC',
  'sample.created': 'SR',
  'quote.created': 'QR',
};

const LIMITS = { body: 16_000, subject: 200, whatsapp: 3_500, email: 12_000 };

/** Parses and checks the request body. Returns an error code or the payload. */
export function parsePayload(raw: unknown): NotifyPayload | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'body' };
  const p = raw as Record<string, unknown>;
  const str = (k: string, max: number) => (typeof p[k] === 'string' && p[k].trim() && p[k].length <= max ? p[k] : null);
  const event = p.event as NotifyPayload['event'];
  if (!(event in PREFIX)) return { error: 'event' };
  const ref = typeof p.ref === 'string' ? p.ref : '';
  if (!new RegExp(`^${PREFIX[event]}-\\d{4}-\\d{4,6}$`).test(ref)) return { error: 'ref' };
  const subject = str('subject', LIMITS.subject);
  const whatsapp = str('whatsapp', LIMITS.whatsapp);
  const email = str('email', LIMITS.email);
  if (!subject || !whatsapp || !email) return { error: 'text' };
  // the texts must be the site's own messages for this reference
  if (!subject.startsWith('[BOGA CAFÉ]') || !subject.includes(ref) || !whatsapp.includes(ref) || !email.includes(ref)) {
    return { error: 'text' };
  }
  return { event, ref, subject, whatsapp, email };
}

/** Best-effort limits per server instance: a burst from one address, and resending the same reference. */
export class Guard {
  private hits = new Map<string, number[]>();
  private seen = new Map<string, number>();
  constructor(
    private max = 6,
    private windowMs = 10 * 60_000,
  ) {}
  allow(ip: string, ref: string, now: number): 'ok' | 'rate' | 'duplicate' {
    const last = this.seen.get(ref);
    if (last !== undefined && now - last < 24 * 3600_000) return 'duplicate';
    const recent = (this.hits.get(ip) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.max) return 'rate';
    recent.push(now);
    this.hits.set(ip, recent);
    this.seen.set(ref, now);
    return 'ok';
  }
}

async function sendWhatsapp(p: NotifyPayload, env: NotifyEnv, deps: NotifyDeps): Promise<Channel> {
  if (!env.CALLMEBOT_PHONE || !env.CALLMEBOT_APIKEY) return 'skipped';
  const url = new URL('https://api.callmebot.com/whatsapp.php');
  url.searchParams.set('phone', env.CALLMEBOT_PHONE.replace(/\D/g, ''));
  url.searchParams.set('text', `🔔 BOGA CAFÉ · site\n${p.whatsapp}`);
  url.searchParams.set('apikey', env.CALLMEBOT_APIKEY);
  try {
    const res = await deps.fetch(url, { signal: AbortSignal.timeout(10_000) });
    const text = await res.text();
    // CallMeBot answers 200 with an explanation page when the key or number is wrong
    if (!res.ok || /error|invalid|not (?:allowed|activated)/i.test(text)) {
      console.error('whatsapp: callmebot refused', res.status, text.slice(0, 200));
      return 'failed';
    }
    return 'sent';
  } catch (e) {
    console.error('whatsapp: request failed', (e as Error).message);
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
      text: p.email,
    });
    return 'sent';
  } catch (e) {
    console.error('email: gmail refused', (e as Error).message);
    return 'failed';
  }
}

const json = (status: number, body: unknown, origin?: string) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
    },
  });

export async function handleNotify(request: Request, env: NotifyEnv, deps: NotifyDeps, guard: Guard): Promise<Response> {
  const origin = request.headers.get('origin') ?? '';
  if (env.ALLOWED_ORIGIN && origin && origin !== env.ALLOWED_ORIGIN) return json(403, { error: 'origin' });
  const cors = env.ALLOWED_ORIGIN && origin ? origin : undefined;
  if (request.method !== 'POST') return json(405, { error: 'method' }, cors);

  const raw = await request.text();
  if (raw.length > LIMITS.body) return json(413, { error: 'size' }, cors);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { error: 'json' }, cors);
  }
  const payload = parsePayload(body);
  if ('error' in payload) return json(400, payload, cors);

  const ip = (request.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  const verdict = guard.allow(ip, payload.ref, deps.now());
  if (verdict === 'rate') return json(429, { error: 'rate' }, cors);
  if (verdict === 'duplicate') return json(200, { whatsapp: 'skipped', email: 'skipped', duplicate: true }, cors);

  const [whatsapp, email] = await Promise.all([sendWhatsapp(payload, env, deps), sendEmail(payload, env, deps)]);
  const ok = whatsapp === 'sent' || email === 'sent';
  const nothingConfigured = whatsapp === 'skipped' && email === 'skipped';
  return json(ok ? 200 : nothingConfigured ? 503 : 502, { whatsapp, email }, cors);
}
