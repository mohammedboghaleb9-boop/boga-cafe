import { afterEach, describe, expect, it, vi } from 'vitest';

const draft = { subject: '[BOGA CAFÉ] Échantillon B2B SR-2026-7K4M2Q - Sara', whatsapp: 'x', email: 'x' };

async function load(url: string) {
  vi.resetModules();
  vi.stubEnv('VITE_NOTIFY_URL', url);
  return import('../deliver');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('automatic delivery status', () => {
  it('does nothing in the prototype (no function configured)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const d = await load('');
    d.deliver('sample.created', 'SR-2026-AAAAAA', draft);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(d.deliveryStatus('SR-2026-AAAAAA')).toBe('off');
  });

  it('goes pending → sent only when the server confirms a channel', async () => {
    let answer!: (r: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((r) => (answer = r))));
    const d = await load('/api/notify');
    const seen: string[] = [];
    d.onDeliveryChange(() => seen.push(d.deliveryStatus('SR-2026-BBBBBB')));
    d.deliver('sample.created', 'SR-2026-BBBBBB', draft);
    expect(d.deliveryStatus('SR-2026-BBBBBB')).toBe('pending');
    answer(new Response(JSON.stringify({ whatsapp: 'failed', email: 'sent' }), { status: 200 }));
    await vi.waitFor(() => expect(d.deliveryStatus('SR-2026-BBBBBB')).toBe('sent'));
    expect(seen).toEqual(['pending', 'sent']);
  });

  it('reports failed when no channel was delivered or the server errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ whatsapp: 'failed', email: 'failed' }), { status: 502 })));
    const d = await load('/api/notify');
    d.deliver('order.created', 'BC-2026-CCCCCC', draft);
    await vi.waitFor(() => expect(d.deliveryStatus('BC-2026-CCCCCC')).toBe('failed'));

    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('network'))));
    d.deliver('order.created', 'BC-2026-DDDDDD', draft);
    await vi.waitFor(() => expect(d.deliveryStatus('BC-2026-DDDDDD')).toBe('failed'));
  });

  it('stops making the customer wait after 9 s, without cancelling the request', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | null | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn((_u: string, init: RequestInit) => {
        signal = init.signal;
        return new Promise<Response>(() => {});
      }),
    );
    const d = await load('/api/notify');
    d.deliver('quote.created', 'QR-2026-EEEEEE', draft);
    vi.advanceTimersByTime(9_000);
    expect(d.deliveryStatus('QR-2026-EEEEEE')).toBe('failed');
    expect(signal).toBeUndefined(); // the request is never aborted: the team may still receive it
  });
});
