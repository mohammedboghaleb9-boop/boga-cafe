/**
 * The Admin Panel's client is still supabase-js with the options it always had, but it is handed over by
 * src/data/adminClient.ts (loaded with the panel) instead of being imported by the shop's code. This pins:
 * the options, that nothing creates it for a visitor, that a panel opened without it fails loudly, that
 * `loadAdminClient` hands it over on the live-database build only, and how the shop's own client is wired.
 */
import { createClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SUPABASE_URL = 'https://admin-test.supabase.test';
const KEY = 'sb_publishable_ADMINTESTKEY0000000000';

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('VITE_SUPABASE_URL', SUPABASE_URL);
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', KEY);
  // no second read of the display catalog after the test ends
  vi.stubEnv('VITE_SHOWCASE', '');
  // the catalog read the backend starts at creation: answered here, nothing leaves the process
  vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { headers: { 'content-type': 'application/json' } })));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the admin client', () => {
  it('is not created for a visitor: the shop starts and reads without it', async () => {
    const { createSupabaseBackend, provideAdminClient } = await import('../index');
    const spy = vi.fn(createClient);
    provideAdminClient(spy as typeof createClient);
    const backend = createSupabaseBackend();
    expect(backend.api).toBeDefined();
    expect(spy).not.toHaveBeenCalled();
  });

  it("reads through the shop's own client: the project's address, the key, and the 15 s timeout on every request", async () => {
    const { createSupabaseBackend } = await import('../index');
    createSupabaseBackend();
    await vi.waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(5));
    for (const [url, init] of vi.mocked(fetch).mock.calls) {
      expect(String(url).startsWith(`${SUPABASE_URL}/rest/v1/`)).toBe(true);
      const h = new Headers(init?.headers);
      expect(h.get('apikey')).toBe(KEY);
      expect(h.get('authorization')).toBe(`Bearer ${KEY}`);
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
    expect(vi.mocked(fetch).mock.calls.map(([url]) => new URL(String(url)).pathname.split('/').at(-1)).sort()).toEqual(['origins', 'payment_methods', 'products', 'shipping_rates', 'site_config']);
  });

  it('is created once, with the same options as before, when the panel first subscribes to its session', async () => {
    const { createSupabaseBackend, provideAdminClient } = await import('../index');
    const spy = vi.fn(createClient);
    provideAdminClient(spy as typeof createClient);
    const backend = createSupabaseBackend();
    backend.admin.session.subscribe(() => undefined)();
    backend.admin.session.subscribe(() => undefined)();
    expect(spy).toHaveBeenCalledTimes(1);
    const [url, key, options] = spy.mock.calls[0];
    expect(url).toBe(SUPABASE_URL);
    expect(key).toBe(KEY);
    expect(options?.auth).toEqual({ storageKey: 'boga-admin-auth', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false });
    expect(Object.keys(options ?? {}).sort()).toEqual(['auth', 'global']);
    expect(typeof options?.global?.fetch).toBe('function');
  });

  it('a panel opened before its sign-in code was provided fails with a clear message, not a silent visitor client', async () => {
    const { createSupabaseBackend } = await import('../index');
    const backend = createSupabaseBackend();
    expect(() => backend.admin.session.subscribe(() => undefined)).toThrow(/Admin Panel opened before its sign-in code was loaded/);
  });

  it('loadAdminClient hands supabase-js to the backend on the live-database build', async () => {
    vi.stubEnv('VITE_DATA_MODE', 'supabase');
    const { loadAdminClient } = await import('../../adminClient');
    const { createSupabaseBackend } = await import('../index');
    await loadAdminClient();
    const backend = createSupabaseBackend();
    expect(() => backend.admin.session.subscribe(() => undefined)()).not.toThrow();
  });

  it('loadAdminClient does nothing on any other build (the demo has no supabase-js to load)', async () => {
    vi.stubEnv('VITE_DATA_MODE', 'demo');
    const { loadAdminClient } = await import('../../adminClient');
    const { createSupabaseBackend } = await import('../index');
    await loadAdminClient();
    const backend = createSupabaseBackend();
    expect(() => backend.admin.session.subscribe(() => undefined)).toThrow(/Admin Panel opened before its sign-in code was loaded/);
  });
});
