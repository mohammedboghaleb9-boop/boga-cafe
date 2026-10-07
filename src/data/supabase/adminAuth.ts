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

/**
 * `client` is created on first use: a visitor of the shop never starts an Auth client.
 * `forget` removes the kept session from this browser: supabase-js keeps it when it
 * cannot read it first (an expired token whose refresh gets no answer).
 */
export function createAdminAuth(client: () => Client, forget: () => void): AdminAuth {
  const listeners = new Set<() => void>();
  let session: AdminSession = { state: 'loading' };
  let started = false;
  /** The account the panel was opened for; a sign-in elsewhere with another one is checked again. */
  let userId: string | null = null;
  let signingIn = false;

  const set = (next: AdminSession) => {
    session = next;
    listeners.forEach((l) => l());
  };

  /**
   * Out of this browser, whatever the network says. Scope 'local': this session only;
   * the admin stays signed in on their other devices.
   */
  async function signOutHere() {
    userId = null;
    const { error } = await client()
      .auth.signOut({ scope: 'local' })
      .catch((e: AuthError) => ({ error: e }));
    if (error) forget();
  }

  /** An account that is not (or no longer) an admin: out again. */
  async function deny() {
    await signOutHere();
    set({ state: 'denied' });
  }

  /** The panel for this account if it is an admin, "no access" if not, the form (session kept) without an answer. */
  async function open(id: string) {
    try {
      const role = await adminRoleOf(client(), id);
      if (!role) return await deny();
      userId = id;
      set({ state: 'signed_in', role });
    } catch (e) {
      console.error('admin session:', e);
      set({ state: 'signed_out', problem: 'server' });
    }
  }

  async function check() {
    try {
      const { data, error } = await client().auth.getSession();
      if (error || !data.session) return set({ state: 'signed_out' });
      await open(data.session.user.id);
    } catch (e) {
      console.error('admin session:', e);
      set({ state: 'signed_out', problem: 'server' });
    }
  }

  function start() {
    client().auth.onAuthStateChange((event, changed) => {
      // the refresh token was refused (expired, revoked) or another tab signed out
      if (event === 'SIGNED_OUT') {
        userId = null;
        if (session.state === 'signed_in') set({ state: 'signed_out' });
      }
      // another tab signed in, maybe with another account: check it (never awaited in here)
      if (event === 'SIGNED_IN' && changed && changed.user.id !== userId && !signingIn) {
        const id = changed.user.id;
        setTimeout(() => void open(id), 0);
      }
    });
    void check();
  }

  return {
    session: {
      get: () => session,
      subscribe(l) {
        if (!started) {
          started = true;
          start();
        }
        listeners.add(l);
        return () => listeners.delete(l);
      },
    },

    async signIn(input) {
      if (!('email' in input)) return 'credentials';
      const email = input.email.trim();
      // nothing to check: Auth's rate limit is not spent on an empty form
      if (!email || !input.password) return 'credentials';
      const db = client();
      signingIn = true;
      try {
        const { data, error } = await db.auth.signInWithPassword({ email, password: input.password });
        if (error) return signInError(error);
        const role = await adminRoleOf(db, data.user.id);
        if (!role) {
          await deny();
          return 'denied';
        }
        userId = data.user.id;
        set({ state: 'signed_in', role });
        return 'ok';
      } catch (e) {
        // signed in but the role could not be read: not left half signed in
        console.error('admin sign-in:', e);
        await signOutHere();
        return 'server';
      } finally {
        signingIn = false;
      }
    },

    async signOut() {
      await signOutHere();
      set({ state: 'signed_out' });
    },

    dismiss() {
      if (session.state === 'denied') set({ state: 'signed_out' });
    },

    retry() {
      set({ state: 'loading' });
      void check();
    },
  };
}
