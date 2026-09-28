import { describe, expect, it, vi } from 'vitest';
import { Guard, handleNotify, handlePreflight, parsePayload, type Mail, type NotifyDeps, type NotifyEnv } from '../_lib/notify.js';

const REF = 'SR-2026-7K4M2Q';
const payload = {
  event: 'sample.created',
  ref: REF,
  subject: `[BOGA CAFÉ] Échantillon B2B ${REF} - Sara Test`,
  whatsapp: `Demande d'échantillon ${REF}\nContact : Sara Test (+212661000000)`,
  email: `Demande d'échantillon ${REF}\nContact : Sara Test (+212661000000)`,
};

const SITE = 'https://bogacafe.ma';
const env: NotifyEnv = {
  GMAIL_USER: 'bogacafe1@gmail.com',
  GMAIL_APP_PASSWORD: 'abcd efgh ijkl mnop',
  CALLMEBOT_PHONE: '+212 609-036378',
  CALLMEBOT_APIKEY: '123456',
  ALLOWED_ORIGIN: `${SITE}, https://www.bogacafe.ma/`,
};

const QUEUED = 'Message queued. You will receive it in a few seconds.';

function setup(opts: { whatsapp?: string; mailFails?: boolean } = {}) {
  const mails: Mail[] = [];
  const urls: URL[] = [];
  let mailFails = opts.mailFails ?? false;
  let whatsappAnswer = opts.whatsapp ?? QUEUED;
  const deps: NotifyDeps = {
    now: () => 1_000_000,
    sendMail: vi.fn(async (m: Mail) => {
      if (mailFails) throw new Error('535 Username and Password not accepted');
      mails.push(m);
    }),
    fetch: vi.fn(async (u: string | URL | Request) => {
      urls.push(new URL(String(u)));
      return new Response(whatsappAnswer, { status: 200 });
    }) as unknown as typeof fetch,
  };
  const heal = () => {
    mailFails = false;
    whatsappAnswer = QUEUED;
  };
  return { deps, mails, urls, guard: new Guard(), heal };
}

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request(`${SITE}/api/notify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: SITE, 'x-real-ip': '41.250.1.1', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

describe('POST /api/notify', () => {
  it('sends the request to the Gmail inbox and the owner WhatsApp, marked as a website form', async () => {
    const { deps, mails, urls, guard } = setup();
    const res = await handleNotify(post(payload), env, deps, guard);
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe(SITE);
    expect(await res.json()).toEqual({ whatsapp: 'sent', email: 'sent' });
    expect(mails[0]).toMatchObject({ to: 'bogacafe1@gmail.com', subject: payload.subject });
    expect(mails[0].text).toContain(payload.email);
    expect(mails[0].text).toContain('ne prouve jamais un paiement');
    expect(urls[0].searchParams.get('phone')).toBe('212609036378');
    expect(urls[0].searchParams.get('apikey')).toBe('123456');
    expect(urls[0].searchParams.get('text')).toContain(REF);
  });

  it('reports each channel on its own, so one failure does not hide the other', async () => {
    const both = setup({ whatsapp: 'APIKey is invalid', mailFails: true });
    const res = await handleNotify(post(payload), env, both.deps, both.guard);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ whatsapp: 'failed', email: 'failed' });

    const one = setup({ whatsapp: 'APIKey is invalid' });
    const res2 = await handleNotify(post(payload), env, one.deps, one.guard);
    expect(res2.status).toBe(200);
    expect(await res2.json()).toEqual({ whatsapp: 'failed', email: 'sent' });
  });

  it('only counts WhatsApp as sent when CallMeBot confirms it', async () => {
    const { deps, guard } = setup({ whatsapp: '<html>Something went wrong</html>' });
    const res = await handleNotify(post(payload), { ...env, GMAIL_USER: '' }, deps, guard);
    expect(await res.json()).toEqual({ whatsapp: 'failed', email: 'skipped' });
  });

  it('retries a message whose delivery failed, then ignores the same message once delivered', async () => {
    const t = setup({ whatsapp: 'down', mailFails: true });
    const first = await handleNotify(post(payload), env, t.deps, t.guard);
    expect(first.status).toBe(502);
    expect(t.mails).toHaveLength(0);

    t.heal();
    const retry = await handleNotify(post(payload), env, t.deps, t.guard);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual({ whatsapp: 'sent', email: 'sent' });
    expect(t.mails).toHaveLength(1);

    const again = await handleNotify(post(payload), env, t.deps, t.guard);
    expect(await again.json()).toMatchObject({ duplicate: true });
    expect(t.mails).toHaveLength(1);
  });

  it('delivers two different requests even if they share a reference', async () => {
    const { deps, mails, guard } = setup();
    await handleNotify(post(payload), env, deps, guard);
    const other = { ...payload, whatsapp: `${payload.whatsapp}\nNote : autre client`, email: `${payload.email}\nNote : autre client` };
    const res = await handleNotify(post(other), env, deps, guard);
    expect(await res.json()).toEqual({ whatsapp: 'sent', email: 'sent' });
    expect(mails).toHaveLength(2);
  });

  it('refuses to work until the website address is configured', async () => {
    const { deps, guard } = setup();
    const res = await handleNotify(post(payload), { ...env, ALLOWED_ORIGIN: '' }, deps, guard);
    expect(res.status).toBe(503);
    expect(deps.sendMail).not.toHaveBeenCalled();
  });

  it('refuses other websites, missing Origin and non-JSON requests', async () => {
    const { deps, guard } = setup();
    expect((await handleNotify(post(payload, { origin: 'https://evil.example' }), env, deps, guard)).status).toBe(403);
    const noOrigin = new Request(`${SITE}/api/notify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    expect((await handleNotify(noOrigin, env, deps, guard)).status).toBe(403);
    expect((await handleNotify(post(payload, { 'content-type': 'text/plain' }), env, deps, guard)).status).toBe(415);
    expect((await handleNotify(post(payload, { origin: 'https://www.bogacafe.ma' }), env, deps, guard)).status).toBe(200);
    expect(deps.sendMail).toHaveBeenCalledTimes(1);
  });

  it('accepts only the three messages of the site', async () => {
    const { deps, guard } = setup();
    for (const bad of [
      { ...payload, event: 'spam' },
      { ...payload, event: '__proto__' },
      { ...payload, event: 'toString' },
      { ...payload, ref: 'BC-2026-7K4M2Q' }, // order prefix on a sample
      { ...payload, ref: 'SR-2026-7k4m2q' },
      { ...payload, subject: `[BOGA CAFÉ] Commande ${REF} - PAYÉE` }, // wrong subject for a sample
      { ...payload, whatsapp: `${REF} Paiement : Carte (payé)` }, // not the site's first line
      { ...payload, email: `Bonjour\n${REF}` },
      { ...payload, email: 'x'.repeat(13_000) },
    ]) {
      expect((await handleNotify(post(bad), env, deps, guard)).status).toBeGreaterThanOrEqual(400);
    }
    expect((await handleNotify(post('not json'), env, deps, guard)).status).toBe(400);
    expect((await handleNotify(post('x'.repeat(25_000)), env, deps, guard)).status).toBe(413);
    expect(deps.sendMail).not.toHaveBeenCalled();
  });

  it('removes links from what it forwards', async () => {
    const { deps, mails, urls, guard } = setup();
    const withLink = {
      ...payload,
      whatsapp: `${payload.whatsapp}\nNote : payez ici https://phish.example/pay et www.evil.ma`,
      email: `${payload.email}\nNote : payez ici https://phish.example/pay`,
    };
    await handleNotify(post(withLink), env, deps, guard);
    expect(mails[0].text).not.toMatch(/phish|https?:/);
    expect(urls[0].searchParams.get('text')).not.toMatch(/phish|evil|www\./);
    expect(mails[0].text).toContain('[lien retiré]');
  });

  it('limits bursts from one address and in total', async () => {
    const { deps, guard } = setup();
    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) {
      const w = `${payload.whatsapp}\nNote : ${i}`;
      statuses.push((await handleNotify(post({ ...payload, whatsapp: w, email: w }), env, deps, guard)).status);
    }
    expect(statuses.filter((s) => s === 429)).toHaveLength(2);

    const total = new Guard(100, 3);
    const results: string[] = [];
    for (let i = 0; i < 4; i++) results.push(total.allow(`10.0.0.${i}`, `k${i}`, 0));
    expect(results).toEqual(['ok', 'ok', 'ok', 'rate']);
  });

  it('forgets old entries, so memory stays bounded', () => {
    const g = new Guard(6, 60, 1_000, 5_000);
    for (let i = 0; i < 50; i++) {
      g.allow(`10.0.0.${i}`, `k${i}`, 0);
      g.markDelivered(`k${i}`, 0);
    }
    g.allow('1.1.1.1', 'fresh', 10_000);
    expect(g.size()).toEqual({ ips: 1, delivered: 0 });
  });

  it('answers the browser pre-flight only for the configured website', () => {
    const ok = handlePreflight(new Request(`${SITE}/api/notify`, { method: 'OPTIONS', headers: { origin: SITE } }), env);
    expect(ok.status).toBe(204);
    expect(ok.headers.get('access-control-allow-origin')).toBe(SITE);
    const no = handlePreflight(new Request(`${SITE}/api/notify`, { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }), env);
    expect(no.status).toBe(403);
  });

  it('parses a valid payload and accepts database-style numbers', () => {
    expect(parsePayload(payload)).toEqual(payload);
    const num = 'BC-2026-10001';
    const order = {
      event: 'order.created',
      ref: num,
      subject: `[BOGA CAFÉ] Commande ${num} - 290 DH`,
      whatsapp: `Nouvelle commande ${num}\nClient : X`,
      email: `Nouvelle commande ${num}\nClient : X`,
    };
    expect('error' in parsePayload(order)).toBe(false);
  });
});
