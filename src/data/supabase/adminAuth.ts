/**
 * Admin sign-in on the live site (slice 5): Supabase Auth, email and password.
 * An account counts as an admin only when the database says so, with the very
 * function its row level security uses (is_admin()); the role comes from its own
 * admin_users row. Any other account is signed out again and sees "no access".
 * The session is kept in the browser and refreshed by supabase-js; its own client
 * (./index.ts) so the shop keeps reading as a visitor. No 2FA yet (slice 6), no
 * sign-up and no password reset here.
 */
import type { AuthError } from '@supabase/supabase-js';
import type { AdminRole } from '@/core/orderFlow';
import type { AdminAuth, AdminSession, SignInResult } from '../types';
import type { Client } from './client';

const ROLES: readonly AdminRole[] = ['owner', 'manager', 'staff'];

/** The role of this signed-in account, or null when it is not an admin. Throws when it cannot tell. */
export async function adminRoleOf(client: Client, userId: string): Promise<AdminRole | null> {
  const [admin, row] = await Promise.all([
    client.rpc('is_admin'),
    // an owner may read every admin row: ask for this account's own
    client.from('admin_users').select('role').eq('user_id', userId).maybeSingle(),
  ]);
  if (admin.error) throw admin.error;
  if (row.error) throw row.error;
  const role = row.data?.role as AdminRole | undefined;
  return admin.data === true && role && ROLES.includes(role) ? role : null;
}

/**
 * Every refusal of the email or the password reads the same ('credentials'): Auth's
 * own messages (no such user, email not confirmed, banned) would tell who has an account.
 */
export function signInError(error: AuthError): Exclude<SignInResult, 'ok' | 'denied'> {
  if (error.status === 429) return 'too_many';
  if (!error.status || error.status >= 500) return 'server';
  return 'credentials';
}

/** `client` is created on first use: a visitor of the shop never starts an Auth client. */
export function createAdminAuth(client: () => Client): AdminAuth {
  const listeners = new Set<() => void>();
  let session: AdminSession = { state: 'loading' };
  let started = false;

  const set = (next: AdminSession) => {
    session = next;
    listeners.forEach((l) => l());
  };

  /** An account that is not (or no longer) an admin: out again. */
  async function deny() {
    await client().auth.signOut();
    set({ state: 'denied' });
  }

  async function start() {
    const db = client();
    db.auth.onAuthStateChange((event) => {
      // the refresh token was refused (expired, revoked) or another tab signed out
      if (event === 'SIGNED_OUT' && session.state === 'signed_in') set({ state: 'signed_out' });
    });
    try {
      const { data, error } = await db.auth.getSession();
      if (error || !data.session) return set({ state: 'signed_out' });
      const role = await adminRoleOf(db, data.session.user.id);
      if (role) set({ state: 'signed_in', role });
      else await deny();
    } catch (e) {
      // no answer: the kept session is not thrown away for a lost connection
      console.error('admin session:', e);
      set({ state: 'signed_out', problem: 'server' });
    }
  }

  return {
    session: {
      get: () => session,
      subscribe(l) {
        if (!started) {
          started = true;
          void start();
        }
        listeners.add(l);
        return () => listeners.delete(l);
      },
    },

    async signIn(input) {
      if (!('email' in input)) return 'credentials';
      const db = client();
      try {
        const { data, error } = await db.auth.signInWithPassword({ email: input.email.trim(), password: input.password });
        if (error) return signInError(error);
        const role = await adminRoleOf(db, data.user.id);
        if (!role) {
          await deny();
          return 'denied';
        }
        set({ state: 'signed_in', role });
        return 'ok';
      } catch (e) {
        // signed in but the role could not be read: not left half signed in
        console.error('admin sign-in:', e);
        await db.auth.signOut().catch(() => undefined);
        return 'server';
      }
    },

    async signOut() {
      // removes the session from this browser even when the server cannot be reached
      await client().auth.signOut();
      set({ state: 'signed_out' });
    },

    dismiss() {
      if (session.state === 'denied') set({ state: 'signed_out' });
    },
  };
}
