/**
 * The visitor's client (PostgrestClient, ../visitorClient.ts) against the one it replaces (supabase-js `createClient`
 * with the options src/data/supabase/index.ts used): the same requests on the wire and the same results, for the calls a
 * visitor makes: the catalog read, the showcase read, and the two order calls (get_order_public, report_offline_payment).
 * Nothing leaves the process: a fake `fetch` records each request and answers from a script.
 */
import { createClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseApi } from '../api';
import { loadCatalog } from '../catalog';
import type { Database } from '../database.types';
import { loadShowcase } from '../showcase';
import { createCatalogStore } from '../store';
import type { ReadClient } from '../client';
import { createVisitorClient } from '../visitorClient';

const SUPABASE_URL = 'https://parity.supabase.test';
const UUID = '0b6f7a3e-1c2d-4e5f-8a9b-0c1d2e3f4a5b';
const b64 = (o: object) => btoa(JSON.stringify(o)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
const KEYS = { publishable: 'sb_publishable_PARITYTESTKEY0000000000', legacyAnon: `${b64({ alg: 'HS256' })}.${b64({ role: 'anon' })}.sig-parity-test` };

interface Seen { method: string; url: string; headers: [string, string][]; clientInfo: string | null; body: string | null; }
type Answer = { status?: number; json?: unknown; text?: string; reject?: Error; headers?: Record<string, string> };
type Script = (r: Seen, n: number) => Answer;

/** What went on the wire, without the telemetry header (compared apart, below). */
const wire = (seen: Seen[]) => seen.map(({ clientInfo: _info, ...r }) => r);

/** `fetch` that records and answers from a script. */
function fakeFetch(script: Script) {
  const seen: Seen[] = [];
  const impl: typeof fetch = async (input, init) => {
    const h = new Headers(init?.headers);
    const r: Seen = {
      method: (init?.method ?? 'GET').toUpperCase(),
      url: typeof input === 'string' ? input : input.toString(),
      headers: [...h.entries()].filter(([k]) => k !== 'x-client-info').sort(([a], [b]) => a.localeCompare(b)),
      clientInfo: h.get('x-client-info'),
      body: typeof init?.body === 'string' ? init.body : null,
    };
    seen.push(r);
    const a = script(r, seen.length);
    if (a.reject) throw a.reject;
    const body = a.json !== undefined ? JSON.stringify(a.json) : (a.text ?? '');
    return new Response(a.status === 204 ? null : body, { status: a.status ?? 200, headers: { 'content-type': a.json !== undefined ? 'application/json' : 'text/plain', ...a.headers } });
  };
  return { seen, impl };
}

/** index.ts's `fetchWithTimeout`, as it is written there. */
const withTimeout = (f: typeof fetch): typeof fetch => (input, init) => f(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(15_000) });

/** The client index.ts builds today (before the change): supabase-js with a visitor's options. */
const legacy = (key: string, f: typeof fetch) => createClient<Database>(SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: withTimeout(f) } });
const candidate = (key: string, f: typeof fetch) => createVisitorClient(SUPABASE_URL, key, withTimeout(f));

/** A transport failure carries the JS stack in `details`: keep its first line (the stack differs by call path, never by meaning). */
const scrub = <T>(v: T): T => JSON.parse(JSON.stringify(v), (k, x) => (k === 'details' && typeof x === 'string' ? x.split('\n')[0] : k === 'stack' ? undefined : x));

const outcome = async (run: () => Promise<unknown>): Promise<{ ok?: unknown; threw?: unknown }> => {
  try {
    return scrub({ ok: await run() });
  } catch (e) {
    const x = e as { name?: string; message?: string; code?: string; details?: string; hint?: string };
    return scrub({ threw: { name: x.name, message: x.message, code: x.code, details: x.details, hint: x.hint } });
  }
};

/** Runs one scenario on both clients with the same script; returns what each sent and what each gave back. */
async function both(key: string, script: Script, use: (c: ReadClient) => Promise<unknown>) {
  const a = fakeFetch(script);
  const b = fakeFetch(script);
  const resultA = await outcome(() => use(legacy(key, a.impl)));
  const resultB = await outcome(() => use(candidate(key, b.impl)));
  return { a, b, resultA, resultB };
}

const L = (s: string) => ({ ar: s, fr: s, en: s });
const tables: Record<string, unknown> = {
  origins: [{ id: 'brazil', name: L('Brésil'), country_code: 'BR', species: 'arabica', region: 'Minas', roast_level: 'medium', tasting_notes: L('Cacao'), stock_kg: '12.5', low_stock_kg: 5, price_per_kg: 220, custom_blend_enabled: true, restock_date: null, active: true, updated_at: '' }],
  products: [{ id: 'p1', slug: 'p1', kind: 'signature', name: L('P1'), tagline: L(''), description: L(''), roast_level: 'medium', tasting_notes: L(''), prices: { 250: 60 }, image_url: null, featured: true, active: true, sort_order: 1, updated_at: '', product_recipes: [{ origin_id: 'brazil', percent: 100 }] }],
  shipping_rates: [{ id: 'oujda', city: L('Oujda'), distance_km: 0, base_fee: 20, included_kg: 3, extra_per_kg: 5, delivery_days: '1', active: true }],
  payment_methods: [{ id: 'cashplus', enabled: true, label: L('Cash Plus'), instructions: L('') }],
  site_config: { settings: { b2bThresholdKg: 25 }, content: {} },
};
const showcaseJson = { products: [{ id: 's1', slug: 's1', kind: 'signature', name: L('S1'), recipe: [{ origin_id: 'brazil', percent: 100 }], sort_order: 1 }], origins: [{ id: 'brazil', name: L('Brésil'), country_code: 'BR' }] };
const catalogScript: Script = (r) => {
  const last = new URL(r.url).pathname.split('/').at(-1) ?? '';
  return last === 'showcase_catalog' ? { json: showcaseJson } : { json: tables[last] ?? [] };
};
const publicOrderRow = { id: UUID, created_at: '2026-10-01T10:00:00Z', status: 'new', payment_status: 'awaiting_payment', payment_method: 'cashplus', payment_ref: null, lines: [], totals: {}, delivery: {}, customer: {} };

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe.each(Object.entries(KEYS))('visitor client parity (%s key)', (_name, key) => {
  it('sends the same requests and returns the same result for the catalog read (5 tables) and the showcase read', async () => {
    const { a, b, resultA, resultB } = await both(key, catalogScript, async (c) => ({ cat: await loadCatalog(c), show: await loadShowcase(c) }));
    expect(resultA.ok).toBeDefined();
    expect(wire(b.seen)).toEqual(wire(a.seen));
    expect(resultB).toEqual(resultA);
    expect(a.seen.map((r) => `${r.method} ${new URL(r.url).pathname}`)).toEqual([
      'GET /rest/v1/origins', 'GET /rest/v1/products', 'GET /rest/v1/shipping_rates', 'GET /rest/v1/payment_methods', 'GET /rest/v1/site_config', 'POST /rest/v1/rpc/showcase_catalog',
    ]);
  });

  it('puts the key in `apikey` and in `Authorization: Bearer` on every request, as supabase-js does', async () => {
    const { a, b } = await both(key, catalogScript, (c) => loadCatalog(c));
    for (const seen of [a.seen, b.seen]) {
      expect(seen.length).toBe(5);
      for (const r of seen) {
        const h = Object.fromEntries(r.headers);
        expect(h.apikey).toBe(key);
        expect(h.authorization).toBe(`Bearer ${key}`);
      }
    }
  });

  it('the only header that differs is X-Client-Info (telemetry: library name and version)', async () => {
    const { a, b } = await both(key, catalogScript, (c) => loadCatalog(c));
    expect(a.seen[0].clientInfo).toMatch(/^supabase-js\//);
    expect(b.seen[0].clientInfo).toBe('postgrest-js');
  });

  it('get_order_public (loadOrder) and report_offline_payment (reportOfflinePayment) send the same calls and end the same', async () => {
    const run = async (c: ReadClient) => {
      const store = createCatalogStore(c, { showcase: false });
      const api = createSupabaseApi({ client: c, store, storefront: { url: SUPABASE_URL, key } });
      await api.loadOrder(UUID);
      const reported = await api.reportOfflinePayment(UUID, '  ref-123  ');
      return { reported, orders: store.db.get().orders };
    };
    const script: Script = (r) => (r.url.endsWith('/rpc/get_order_public') ? { json: [publicOrderRow] } : { status: 204 });
    const { a, b, resultA, resultB } = await both(key, script, run);
    expect(wire(b.seen)).toEqual(wire(a.seen));
    expect(resultB).toEqual(resultA);
    expect(a.seen.map((r) => `${r.method} ${new URL(r.url).pathname} ${r.body ?? ''}`)).toEqual([
      `POST /rest/v1/rpc/get_order_public {"p_order_id":"${UUID}"}`,
      `POST /rest/v1/rpc/report_offline_payment {"p_order_id":"${UUID}","p_ref":"ref-123"}`,
      `POST /rest/v1/rpc/get_order_public {"p_order_id":"${UUID}"}`,
    ]);
  });

  it('a refused report returns false on both', async () => {
    const run = async (c: ReadClient) => {
      const api = createSupabaseApi({ client: c, store: createCatalogStore(c, { showcase: false }), storefront: { url: SUPABASE_URL, key } });
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      return api.reportOfflinePayment(UUID, 'x');
    };
    const { a, b, resultA, resultB } = await both(key, () => ({ status: 400, json: { code: 'P0001', message: 'order_not_found', details: null, hint: null } }), run);
    expect(resultA).toEqual({ ok: false });
    expect(resultB).toEqual(resultA);
    expect(wire(b.seen)).toEqual(wire(a.seen));
  });

  describe('answers and failures (same result, same number of requests)', () => {
    const cases: [string, Script][] = [
      ['PostgREST error 400', () => ({ status: 400, json: { code: '42501', message: 'permission denied', details: 'd', hint: 'h' } })],
      ['401 invalid JWT', () => ({ status: 401, json: { code: 'PGRST301', message: 'JWT expired', details: null, hint: null } })],
      ['404 JSON', () => ({ status: 404, json: { code: 'PGRST202', message: 'function not found', details: null, hint: null } })],
      ['500 plain text', () => ({ status: 500, text: 'internal error' })],
      ['502 html', () => ({ status: 502, text: '<html>bad gateway</html>' })],
      ['network failure', () => ({ reject: new TypeError('Failed to fetch') })],
      ['aborted', () => ({ reject: Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }) })],
      ['200 empty list', () => ({ json: [] })],
      ['204 no content', () => ({ status: 204 })],
      ['200 not json', () => ({ text: 'ok' })],
    ];
    it.each(cases)('catalog read: %s', async (_n, script) => {
      vi.useFakeTimers();
      const p = both(key, script, (c) => loadCatalog(c));
      await vi.runAllTimersAsync();
      const { a, b, resultA, resultB } = await p;
      expect(b.seen.length).toBe(a.seen.length);
      expect(wire(b.seen)).toEqual(wire(a.seen));
      expect(resultB).toEqual(resultA);
    });
    it.each(cases)('rpc get_order_public: %s', async (_n, script) => {
      vi.useFakeTimers();
      const p = both(key, script, async (c) => (await c.rpc('get_order_public', { p_order_id: UUID })));
      await vi.runAllTimersAsync();
      const { a, b, resultA, resultB } = await p;
      expect(wire(b.seen)).toEqual(wire(a.seen));
      expect(resultB).toEqual(resultA);
    });
    it('a transient 520 on a read is retried the same way (a second request, then the answer)', async () => {
      vi.useFakeTimers();
      const p = both(key, (r, n) => (n === 1 ? { status: 520, text: 'cf' } : { json: tables[new URL(r.url).pathname.split('/').at(-1) ?? ''] ?? [] }), (c) => loadCatalog(c));
      await vi.runAllTimersAsync();
      const { a, b, resultA, resultB } = await p;
      expect(a.seen.length).toBeGreaterThan(5);
      expect(b.seen.length).toBe(a.seen.length);
      expect(resultB).toEqual(resultA);
    });
  });
});
