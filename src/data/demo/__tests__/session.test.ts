import { afterEach, describe, expect, it, vi } from 'vitest';

/** A page reload = the module loads again with what the tab already stored. */
async function reloadWith(stored: string | null) {
  const store = new Map<string, string>(stored === null ? [] : [['boga-admin-role', stored]]);
  vi.stubGlobal('sessionStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  vi.resetModules();
  return import('../session');
}

afterEach(() => vi.unstubAllGlobals());

describe('prototype admin session', () => {
  it('stays signed in after a page reload', async () => {
    for (const role of ['owner', 'manager', 'staff']) {
      const { demoAdmin } = await reloadWith(role);
      expect(demoAdmin.session.get()).toEqual({ state: 'signed_in', role });
    }
  });

  it('treats an unknown or missing stored role as signed out', async () => {
    for (const bad of ['root', '', null]) {
      const { demoAdmin } = await reloadWith(bad);
      expect(demoAdmin.session.get()).toEqual({ state: 'signed_out' });
    }
  });

  it('signs in only with the demo password, and signs out', async () => {
    const { demoAdmin, DEMO_PASSWORD } = await reloadWith(null);
    expect(await demoAdmin.signIn({ role: 'manager', password: 'wrong' })).toBe('credentials');
    expect(demoAdmin.session.get().state).toBe('signed_out');
    expect(await demoAdmin.signIn({ role: 'manager', password: DEMO_PASSWORD })).toBe('ok');
    expect(demoAdmin.session.get()).toEqual({ state: 'signed_in', role: 'manager' });
    await demoAdmin.signOut();
    expect(demoAdmin.session.get().state).toBe('signed_out');
  });
});
