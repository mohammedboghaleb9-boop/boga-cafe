/**
 * Prototype admin sign-in, kept for the browser tab only: pick a role, type the
 * public demo password. The live site signs in with Supabase Auth instead
 * (src/data/supabase/adminAuth.ts).
 */
import type { AdminRole } from '@/core/orderFlow';
import type { AdminAuth, AdminSession } from '../types';

const KEY = 'boga-admin-role';
export const DEMO_PASSWORD = 'boga2026';

// declared before read() runs below: reading it earlier throws, and the
// try/catch would turn every page reload into a sign-out
const ROLES: readonly AdminRole[] = ['owner', 'manager', 'staff'];

const listeners = new Set<() => void>();
let session: AdminSession = read();

/** Anything but a known role (edited by hand, older version) means signed out. */
function read(): AdminSession {
  try {
    const stored = sessionStorage.getItem(KEY);
    return ROLES.includes(stored as AdminRole) ? { state: 'signed_in', role: stored as AdminRole } : { state: 'signed_out' };
  } catch {
    return { state: 'signed_out' };
  }
}

function set(next: AdminSession) {
  session = next;
  try {
    if (next.state === 'signed_in') sessionStorage.setItem(KEY, next.role);
    else sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

export const demoAdmin: AdminAuth = {
  session: {
    get: () => session,
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  },
  async signIn(input) {
    if (!('role' in input) || input.password !== DEMO_PASSWORD || !ROLES.includes(input.role)) return 'credentials';
    set({ state: 'signed_in', role: input.role });
    return 'ok';
  },
  async signOut() {
    set({ state: 'signed_out' });
  },
  dismiss() {
    set({ state: 'signed_out' });
  },
  demoPassword: DEMO_PASSWORD,
};
