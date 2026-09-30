import { afterEach, describe, expect, it, vi } from 'vitest';

const draft = { subject: '[BOGA CAFÉ] Demande B2B QR-2026-7K4M2Q - Sara', whatsapp: 'x', email: 'x' };

/** One tab's sessionStorage: a page reload re-imports the module with what the tab kept. */
function tabStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal('sessionStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  });
  return store;
}

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
    d.deliver('quote.created', 'QR-2026-AAAAAA', draft);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(d.deliveryStatus('quote.created', 'QR-2026-AAAAAA')).toBe('off');
  });

  it('goes pending → sent only when the server confirms a channel', async () => {
    let answer!: (r: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((r) => (answer = r))));
    const d = await load('/api/notify');
    const seen: string[] = [];
    d.onDeliveryChange(() => seen.push(d.deliveryStatus('quote.created', 'QR-2026-BBBBBB')));
    d.deliver('quote.created', 'QR-2026-BBBBBB', draft);
    expect(d.deliveryStatus('quote.created', 'QR-2026-BBBBBB')).toBe('pending');
    answer(new Response(JSON.stringify({ whatsapp: 'failed', email: 'sent' }), { status: 200 }));
    await vi.waitFor(() => expect(d.deliveryStatus('quote.created', 'QR-2026-BBBBBB')).toBe('sent'));
    expect(seen).toEqual(['pending', 'sent']);
  });

  it('reports failed when no channel was delivered or the server errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ whatsapp: 'failed', email: 'failed' }), { status: 502 })));
    const d = await load('/api/notify');
    d.deliver('order.created', 'BC-2026-CCCCCC', draft);
    await vi.waitFor(() => expect(d.deliveryStatus('order.created', 'BC-2026-CCCCCC')).toBe('failed'));

    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('network'))));
    d.deliver('order.created', 'BC-2026-DDDDDD', draft);
    await vi.waitFor(() => expect(d.deliveryStatus('order.created', 'BC-2026-DDDDDD')).toBe('failed'));
  });

  it('shows the manual step after 9 s, and still reports a late confirmation (review NEW-6)', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | null | undefined;
    let answer!: (r: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn((_u: string, init: RequestInit) => {
        signal = init.signal;
        return new Promise<Response>((r) => (answer = r));
      }),
    );
    const d = await load('/api/notify');
    d.deliver('quote.created', 'QR-2026-EEEEEE', draft);
    vi.advanceTimersByTime(9_000);
    expect(d.deliveryStatus('quote.created', 'QR-2026-EEEEEE')).toBe('slow');
    expect(signal).toBeUndefined(); // the request is never aborted: the team may still receive it
    // Gmail answered at 15 s: the customer is told it arrived, not that it failed
    vi.advanceTimersByTime(6_000);
    answer(new Response(JSON.stringify({ whatsapp: 'failed', email: 'sent' }), { status: 200 }));
    vi.useRealTimers();
    await vi.waitFor(() => expect(d.deliveryStatus('quote.created', 'QR-2026-EEEEEE')).toBe('sent'));
  });

  it('remembers the result after a page reload in the same tab', async () => {
    const tab = tabStorage();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ whatsapp: 'sent', email: 'sent' }), { status: 200 })));
    const first = await load('/api/notify');
    first.deliver('quote.created', 'QR-2026-FFFFFF', draft);
    await vi.waitFor(() => expect(first.deliveryStatus('quote.created', 'QR-2026-FFFFFF')).toBe('sent'));

    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    first.deliver('quote.created', 'QR-2026-GGGGGG', draft); // still waiting when the page reloads
    expect(tab.size).toBe(1);

    const reloaded = await load('/api/notify');
    expect(reloaded.deliveryStatus('quote.created', 'QR-2026-FFFFFF')).toBe('sent');
    expect(reloaded.deliveryStatus('quote.created', 'QR-2026-GGGGGG')).toBe('slow'); // unknown answer: manual step, never "failed"
    expect(reloaded.deliveryStatus('quote.created', 'QR-2026-HHHHHH')).toBe('off');
  });

  it('does not record a request cut by a page reload as failed (review)', async () => {
    const tab = tabStorage();
    const page = new EventTarget();
    vi.stubGlobal('addEventListener', page.addEventListener.bind(page));
    let cut!: (e: Error) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((_, reject) => (cut = reject))));
    const d = await load('/api/notify');
    d.deliver('quote.created', 'QR-2026-KKKKKK', draft);
    page.dispatchEvent(new Event('pagehide')); // the customer reloads: the browser cuts the request
    cut(new TypeError('Failed to fetch'));
    await new Promise((r) => setTimeout(r, 0));
    expect(d.deliveryStatus('quote.created', 'QR-2026-KKKKKK')).toBe('pending');
    expect(tab.get('boga.delivery')).toContain('"quote.created QR-2026-KKKKKK":"pending"');
    const reloaded = await load('/api/notify');
    expect(reloaded.deliveryStatus('quote.created', 'QR-2026-KKKKKK')).toBe('slow');

    // the page comes back from the back/forward cache: real failures count again
    page.dispatchEvent(new Event('pageshow'));
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('network'))));
    d.deliver('quote.created', 'QR-2026-LLLLLL', draft);
    await vi.waitFor(() => expect(d.deliveryStatus('quote.created', 'QR-2026-LLLLLL')).toBe('failed'));
  });

  it('follows an order and its payment report separately, though they share a reference', async () => {
    let answer!: (r: Response) => void;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ whatsapp: 'sent' }), { status: 200 })));
    const d = await load('/api/notify');
    d.deliver('order.created', 'BC-2026-MMMMMM', draft);
    await vi.waitFor(() => expect(d.deliveryStatus('order.created', 'BC-2026-MMMMMM')).toBe('sent'));
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((r) => (answer = r))));
    d.deliver('payment.reported', 'BC-2026-MMMMMM', draft);
    expect(d.deliveryStatus('payment.reported', 'BC-2026-MMMMMM')).toBe('pending');
    expect(d.deliveryStatus('order.created', 'BC-2026-MMMMMM')).toBe('sent');
    answer(new Response('{}', { status: 502 }));
    await vi.waitFor(() => expect(d.deliveryStatus('payment.reported', 'BC-2026-MMMMMM')).toBe('failed'));
    expect(d.deliveryStatus('order.created', 'BC-2026-MMMMMM')).toBe('sent');
  });

  it('works when the browser refuses storage (private mode)', async () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ whatsapp: 'sent' }), { status: 200 })));
    const d = await load('/api/notify');
    d.deliver('order.created', 'BC-2026-JJJJJJ', draft);
    await vi.waitFor(() => expect(d.deliveryStatus('order.created', 'BC-2026-JJJJJJ')).toBe('sent'));
  });
});
