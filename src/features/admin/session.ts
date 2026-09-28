/**
 * Prototype admin session (kept for the browser tab only).
 * Production: Supabase Auth (email + password, optional 2FA) and the role
 * stored in the `admin_users` table, enforced by database policies (RLS).
 */
import { useSyncExternalStore } from 'react';
import type { Role } from './permissions';

const KEY = 'boga-admin-role';
export const DEMO_PASSWORD = 'boga2026';

// declared before read() runs below: reading it earlier throws, and the
// try/catch would turn every page reload into a sign-out
const ROLES: readonly Role[] = ['owner', 'manager', 'staff'];

const listeners = new Set<() => void>();
let role: Role | null = read();

/** Anything but a known role (edited by hand, older version) means signed out. */
function read(): Role | null {
  try {
    const stored = sessionStorage.getItem(KEY);
    return ROLES.includes(stored as Role) ? (stored as Role) : null;
  } catch {
    return null;
  }
}

export const adminSession = {
  signIn(r: Role) {
    role = r;
    try {
      sessionStorage.setItem(KEY, r);
    } catch {
      /* ignore */
    }
    listeners.forEach((l) => l());
  },
  signOut() {
    role = null;
    try {
      sessionStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    listeners.forEach((l) => l());
  },
};

export function useAdminRole(): Role | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => role,
    () => role,
  );
}

/** The role right now, outside React (tests, guards). */
export const currentAdminRole = (): Role | null => role;
