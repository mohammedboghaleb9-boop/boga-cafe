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

describe('admin session', () => {
  it('stays signed in after a page reload', async () => {
    for (const role of ['owner', 'manager', 'staff']) {
      const { currentAdminRole } = await reloadWith(role);
      expect(currentAdminRole()).toBe(role);
    }
  });

  it('treats an unknown or missing stored role as signed out', async () => {
    for (const bad of ['root', '', null]) {
      const { currentAdminRole } = await reloadWith(bad);
      expect(currentAdminRole()).toBeNull();
    }
  });
});
