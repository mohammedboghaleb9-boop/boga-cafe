/** Who may start an outbox run, and what the answer tells (src/server/outboxHttp.ts). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleOutbox, sameKey, type OutboxHttpDeps } from '../outboxHttp';

const KEY = 'a-long-random-shared-key-0123456789';

function deps(over: Partial<OutboxHttpDeps> = {}, claim: () => Promise<unknown> = async () => ({ data: [], error: null })): OutboxHttpDeps {
  return {
    key: KEY,
    db: { rpc: vi.fn(claim) } as never,
    env: { CALLMEBOT_APIKEY: 'k' },
    sendMail: vi.fn(),
    fetch: vi.fn(),
    ...over,
  };
}
const call = (d: OutboxHttpDeps, init: RequestInit & { key?: string | null } = {}) => {
  const { key, ...rest } = init;
  return handleOutbox(new Request('https://x.test/notify-outbox', { method: 'POST', headers: key === null ? {} : { 'x-outbox-key': key ?? KEY }, ...rest }), d);
};

beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

describe('notify-outbox: who may start a run', () => {
  it('a key shorter than 32 characters is as good as none', async () => {
    for (const key of ['', ' ', 'x', 'a-key-of-31-characters-long-xxx']) {
      const d = deps({ key });
      expect((await call(d, { key })).status).toBe(503);
      expect(d.db.rpc).not.toHaveBeenCalled();
    }
  });

  it('only POST', async () => {
    const d = deps();
    expect((await call(d, { method: 'GET' })).status).toBe(405);
    expect(d.db.rpc).not.toHaveBeenCalled();
  });

  it('without its OUTBOX_KEY secret every call is refused: none runs unchecked', async () => {
    const d = deps({ key: '' });
    expect((await call(d)).status).toBe(503);
    expect((await call(d, { key: '' })).status).toBe(503);
    expect(d.db.rpc).not.toHaveBeenCalled();
  });

  it('a missing or wrong key is 401 and starts nothing', async () => {
    const d = deps();
    for (const key of [null, '', 'wrong', `${KEY}x`, KEY.slice(0, -1)]) expect((await call(d, { key })).status).toBe(401);
    expect(d.db.rpc).not.toHaveBeenCalled();
  });

  it('the key is compared without stopping at the first different character', () => {
    expect(sameKey(KEY, KEY)).toBe(true);
    expect(sameKey(KEY, `${KEY.slice(0, -1)}!`)).toBe(false);
    expect(sameKey('', '')).toBe(true);
    expect(sameKey(KEY, '')).toBe(false);
  });
});

describe('notify-outbox: the answer', () => {
  it('the right key runs and answers counts only, never a message, a recipient or a key', async () => {
    const rows = [{ id: 1, channel: 'whatsapp', event: 'order.created', recipient: '212600000000', subject: '', body: 'secret customer text', attempts: 1 }];
    const d = deps({ fetch: vi.fn(async () => new Response('Message queued')) as never }, async () => ({ data: rows, error: null }));
    const res = await call(d);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ channels: ['whatsapp'], taken: 1, sent: 1, failed: 0 });
    for (const secret of ['secret customer text', '212600000000', KEY]) expect(text).not.toContain(secret);
  });

  it('a failed take is a 500 that says only run_failed', async () => {
    const d = deps({}, async () => ({ data: null, error: { code: '42501', message: 'permission denied for function claim_outbox' } }));
    const res = await call(d);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'run_failed' });
    expect(vi.mocked(console.error).mock.calls.flat().join(' ')).toContain('run failed');
  });
});
