import { describe, expect, it } from 'vitest';
import { handleHttp, keysOf, MAX_BODY_CHARS, visitorIp, type HttpDeps } from '../http';

const KEY = 'sb_publishable_test';

function server(run?: HttpDeps['run']) {
  const seen: { route: string; raw: unknown; ip: string | null }[] = [];
  const deps: HttpDeps = {
    publicKeys: [KEY],
    run: run ?? (async (route, raw, ip) => (seen.push({ route, raw, ip }), { status: 200, body: { ok: true } })),
  };
  const call = (path: string, init: RequestInit = {}) => handleHttp(new Request(`https://x.supabase.co/functions/v1/storefront/${path}`, init), deps);
  return { call, seen };
}
const post = (body: string, headers: Record<string, string> = {}): RequestInit => ({ method: 'POST', body, headers: { apikey: KEY, ...headers } });

describe('storefront http: who may call, and with what', () => {
  it('answers only the two forms, by POST, with the publishable key', async () => {
    const { call, seen } = server();
    expect((await call('sample', post('{}'))).status).toBe(404);
    expect((await call('order', { method: 'GET', headers: { apikey: KEY } })).status).toBe(405);
    expect((await call('order', post('{}', { apikey: '' }))).status).toBe(401);
    expect((await call('order', post('{}', { apikey: 'sb_publishable_other' }))).status).toBe(401);
    expect((await call('order', { method: 'OPTIONS' })).status).toBe(200);
    expect(seen).toEqual([]);
    expect((await call('quote', post('{"a":1}'))).status).toBe(200);
    expect(seen).toEqual([{ route: 'quote', raw: { a: 1 }, ip: null }]);
  });

  it('refuses a body too large even without a length header, and one that is not JSON', async () => {
    const { call, seen } = server();
    const big = JSON.stringify({ notes: 'x'.repeat(MAX_BODY_CHARS) });
    const chunked = new ReadableStream({ start: (c) => (c.enqueue(new TextEncoder().encode(big)), c.close()) });
    expect((await call('order', { ...post(''), body: chunked, duplex: 'half' } as RequestInit)).status).toBe(413);
    expect((await call('order', post('{'))).status).toBe(400);
    expect(seen).toEqual([]);
  });

  it('turns an unexpected failure into a 500 without details', async () => {
    const { call } = server(async () => {
      throw new Error('database password is …');
    });
    const r = await call('order', post('{}'));
    expect(r.status).toBe(500);
    expect(await r.text()).toBe('{"error":"server_error"}');
  });
});

describe('storefront http: the visitor IP', () => {
  const h = (init: Record<string, string>) => new Headers(init);

  it("uses Cloudflare's header only: x-forwarded-for can be written by the client or be a shared proxy", () => {
    expect(visitorIp(h({ 'cf-connecting-ip': '196.1.1.1', 'x-forwarded-for': '6.6.6.6, 196.1.1.1' }))).toBe('196.1.1.1');
    expect(visitorIp(h({ 'x-forwarded-for': '6.6.6.6, 7.7.7.7, 196.2.2.2', 'x-real-ip': '196.3.3.3' }))).toBeNull();
    expect(visitorIp(h({}))).toBeNull();
  });

  it('reads the platform key lists, whatever they hold', () => {
    expect(keysOf('{"default":"sb_publishable_a","other":"sb_publishable_b"}')).toEqual(['sb_publishable_a', 'sb_publishable_b']);
    expect(keysOf('')).toEqual([]);
    expect(keysOf('not json')).toEqual([]);
    expect(keysOf('{"default":""}')).toEqual([]);
  });
});
