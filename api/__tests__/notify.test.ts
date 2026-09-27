import { describe, expect, it, vi } from 'vitest';
import { Guard, handleNotify, parsePayload, type Mail, type NotifyDeps, type NotifyEnv } from '../_lib/notify';

const payload = {
  event: 'sample.created',
  ref: 'SR-2026-0004',
  subject: '[BOGA CAFÉ] Échantillon B2B SR-2026-0004 - Sara Test',
  whatsapp: "Demande d'échantillon SR-2026-0004\nContact : Sara Test (+212661000000)",
  email: "Demande d'échantillon SR-2026-0004\nContact : Sara Test (+212661000000)",
};

const env: NotifyEnv = {
  GMAIL_USER: 'bogacafe1@gmail.com',
  GMAIL_APP_PASSWORD: 'abcd efgh ijkl mnop',
  CALLMEBOT_PHONE: '+212 609-036378',
  CALLMEBOT_APIKEY: '123456',
};

function setup(whatsappAnswer = 'Message queued. You will receive it in a few seconds.', mailFails = false) {
  const mails: Mail[] = [];
  const urls: URL[] = [];
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
  return { deps, mails, urls, guard: new Guard() };
}

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('https://bogacafe.ma/api/notify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '41.250.1.1', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

describe('POST /api/notify', () => {
  it('sends the request to the Gmail inbox and the owner WhatsApp', async () => {
    const { deps, mails, urls, guard } = setup();
    const res = await handleNotify(post(payload), env, deps, guard);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ whatsapp: 'sent', email: 'sent' });
    expect(mails[0]).toMatchObject({ to: 'bogacafe1@gmail.com', subject: payload.subject, text: payload.email });
    expect(urls[0].searchParams.get('phone')).toBe('212609036378');
    expect(urls[0].searchParams.get('apikey')).toBe('123456');
    expect(urls[0].searchParams.get('text')).toContain('SR-2026-0004');
  });

  it('reports each channel on its own, so one failure does not hide the other', async () => {
    const { deps, guard } = setup('APIKey is invalid', true);
    const res = await handleNotify(post(payload), env, deps, guard);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ whatsapp: 'failed', email: 'failed' });

    const ok = setup('APIKey is invalid');
    const res2 = await handleNotify(post(payload), env, ok.deps, ok.guard);
    expect(res2.status).toBe(200);
    expect(await res2.json()).toEqual({ whatsapp: 'failed', email: 'sent' });
  });

  it('says so when nothing is configured yet', async () => {
    const { deps, guard } = setup();
    const res = await handleNotify(post(payload), {}, deps, guard);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ whatsapp: 'skipped', email: 'skipped' });
  });

  it('refuses anything that is not one of the site messages', async () => {
    const { deps, guard } = setup();
    for (const bad of [
      { ...payload, event: 'spam' },
      { ...payload, ref: 'BC-2026-0004' }, // wrong prefix for a sample
      { ...payload, subject: 'Hello' },
      { ...payload, whatsapp: 'Buy now' },
      { ...payload, email: 'x'.repeat(20_000) },
    ]) {
      expect((await handleNotify(post(bad), env, deps, guard)).status).toBeGreaterThanOrEqual(400);
    }
    expect((await handleNotify(post('not json'), env, deps, guard)).status).toBe(400);
    expect(deps.sendMail).not.toHaveBeenCalled();
  });

  it('ignores a reference already delivered, but lets a failed one be retried', async () => {
    const failing = setup('down', true);
    await handleNotify(post(payload), env, failing.deps, failing.guard);
    const retry = await handleNotify(post(payload), env, { ...failing.deps, sendMail: async () => undefined }, failing.guard);
    expect(retry.status).toBe(200);
    const again = await handleNotify(post(payload), env, failing.deps, failing.guard);
    expect(await again.json()).toMatchObject({ duplicate: true });
  });

  it('limits bursts from one address and requests from other websites', async () => {
    const { deps, guard } = setup();
    const statuses: number[] = [];
    for (let i = 1; i <= 8; i++) {
      const ref = `SR-2026-00${String(i).padStart(2, '0')}`;
      const body = { ...payload, ref, subject: `[BOGA CAFÉ] ${ref}`, whatsapp: ref, email: ref };
      statuses.push((await handleNotify(post(body), env, deps, guard)).status);
    }
    expect(statuses.filter((s) => s === 429)).toHaveLength(2);
    const foreign = await handleNotify(post(payload, { origin: 'https://evil.example' }), { ...env, ALLOWED_ORIGIN: 'https://bogacafe.ma' }, deps, new Guard());
    expect(foreign.status).toBe(403);
  });

  it('parses a valid payload', () => {
    expect(parsePayload(payload)).toEqual(payload);
  });
});
