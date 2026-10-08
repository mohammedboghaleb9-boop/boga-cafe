/**
 * Admin sign-in on the live site: Supabase Auth, email and password (slice 5), then the
 * code of an authenticator app (TOTP, slice 6). An account counts as an admin only when
 * the database says so, with the very function its row level security uses (is_admin()),
 * and is_admin() is true only once the session passed the second factor (aal2, migration
 * 20261008205033). A refreshed token without it (the app removed from the account) goes
 * back to the code. Before that, the account's own admin_users row (readable at aal1) tells
 * whether to ask for the code at all: any other account is signed out again and sees
 * "no access". The session is kept in the browser and refreshed by supabase-js; its own
 * client (./index.ts) so the shop keeps reading as a visitor. No sign-up and no password
 * reset here. The TOTP secret is handed to the setup screen once and kept nowhere.
 */
import type { AuthError } from '@supabase/supabase-js';
import type { AdminRole } from '@/core/orderFlow';
import type { AdminAuth, AdminSession, CodeResult, SignInResult, TotpSetup } from '../types';
import type { Client } from './client';

const ROLES: readonly AdminRole[] = ['owner', 'manager', 'staff'];
/** The name the authenticator app shows next to the account (ASCII: every app reads it). */
const TOTP_ISSUER = 'BOGA CAFE';

/** The role of this account's own admin_users row, or null when it has none. Throws when it cannot tell. */
export async function ownRole(client: Client, userId: string): Promise<AdminRole | null> {
  // an owner may read every admin row: ask for this account's own
  const { data, error } = await client.from('admin_users').select('role').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  const role = data?.role as AdminRole | undefined;
  return role && ROLES.includes(role) ? role : null;
}

/** is_admin(): the database's own answer for this session. Throws when it cannot tell. */
async function databaseSaysAdmin(client: Client): Promise<boolean> {
  const { data, error } = await client.rpc('is_admin');
  if (error) throw error;
  return data === true;
}

/** The assurance level a token carries (its 'aal' claim), read locally; null when it cannot be read. */
export function tokenLevel(token: string): string | null {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const aal = (JSON.parse(atob(payload)) as { aal?: unknown }).aal;
    return typeof aal === 'string' ? aal : null;
  } catch {
    return null;
  }
}

/** Auth's rate limit, then no connection or a server fault; anything else is the caller's to name. */
function authProblem(error: AuthError): 'too_many' | 'server' | null {
  if (error.status === 429) return 'too_many';
  if (!error.status || error.status >= 500) return 'server';
  return null;
}

/**
 * Every refusal of the email or the password reads the same ('credentials'): Auth's
 * own messages (no such user, email not confirmed, banned) would tell who has an account.
 */
export function signInError(error: AuthError): Exclude<SignInResult, 'ok' | 'denied'> {
  return authProblem(error) ?? 'credentials';
}

/** A wrong, expired or unknown code all read 'wrong_code'. */
export function codeError(error: AuthError): Exclude<CodeResult, 'ok' | 'denied'> {
  return authProblem(error) ?? 'wrong_code';
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
  /** The account the panel (or its second step) was opened for; a sign-in elsewhere with another one is checked again. */
  let userId: string | null = null;
  /** A sign-in, a code or the kept session is being checked here: Auth's own events about it are not news. */
  let busy = false;
  /** The factor of the app being set up (its id only: the secret stays with the setup screen). */
  let settingUp: string | null = null;

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
    settingUp = null;
    const { error } = await client()
      .auth.signOut({ scope: 'local' })
      .catch((e: AuthError) => ({ error: e }));
    if (error) forget();
  }

  /** An account that is not (or no longer) an admin: out again. */
  async function deny(): Promise<'denied'> {
    await signOutHere();
    set({ state: 'denied' });
    return 'denied';
  }

  /**
   * Where this signed-in account goes: "no access", the second step (password only, aal1),
   * or the panel (aal2, confirmed by is_admin()). Throws when it cannot tell.
   */
  async function place(id: string): Promise<'ok' | 'denied'> {
    const db = client();
    const role = await ownRole(db, id);
    if (!role) return deny();
    const level = await db.auth.mfa.getAuthenticatorAssuranceLevel();
    if (level.error) throw level.error;
    if (level.data.currentLevel !== 'aal2') {
      // from the server, not the session: a factor set up in another tab counts
      const factors = await db.auth.mfa.listFactors();
      if (factors.error) throw factors.error;
      userId = id;
      settingUp = null;
      set({ state: 'second_factor', enrolled: factors.data.totp.length > 0 });
      return 'ok';
    }
    if (!(await databaseSaysAdmin(db))) return deny();
    userId = id;
    settingUp = null;
    set({ state: 'signed_in', role });
    return 'ok';
  }

  /** The kept session: where it goes, the form when there is none, the form (session kept) without an answer. */
  async function check() {
    // supabase-js announces the session it reads from storage (SIGNED_IN): this check answers it
    busy = true;
    try {
      const { data, error } = await client().auth.getSession();
      if (error || !data.session) return set({ state: 'signed_out' });
      await place(data.session.user.id);
    } catch (e) {
      console.error('admin session:', e);
      set({ state: 'signed_out', problem: 'server' });
    } finally {
      busy = false;
    }
  }

  /** Placed again, never awaited inside Auth's own callback. */
  const recheck = () => setTimeout(() => void check(), 0);

  function start() {
    client().auth.onAuthStateChange((event, changed) => {
      // the refresh token was refused (expired, revoked) or another tab signed out
      if (event === 'SIGNED_OUT') {
        userId = null;
        settingUp = null;
        if (session.state === 'signed_in' || session.state === 'second_factor') set({ state: 'signed_out' });
      }
      if (busy) return;
      // another tab signed in, maybe with another account
      if (event === 'SIGNED_IN' && changed && changed.user.id !== userId) recheck();
      // another tab passed the second step for this account
      if (event === 'MFA_CHALLENGE_VERIFIED' && session.state === 'second_factor') recheck();
      // the refreshed token lost the second factor (the app was removed): the panel closes, the code is asked
      if (event === 'TOKEN_REFRESHED' && session.state === 'signed_in' && changed && tokenLevel(changed.access_token) !== 'aal2') recheck();
    });
    void check();
  }

  /** The factor the code is for: the one being set up here, else the account's app. */
  async function factorForCode(): Promise<string | null> {
    if (settingUp) return settingUp;
    const factors = await client().auth.mfa.listFactors();
    if (factors.error) throw factors.error;
    return factors.data.totp[0]?.id ?? null;
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
      busy = true;
      try {
        const { data, error } = await db.auth.signInWithPassword({ email, password: input.password });
        if (error) return signInError(error);
        return await place(data.user.id);
      } catch (e) {
        // signed in but its place could not be read: not left half signed in
        console.error('admin sign-in:', e);
        await signOutHere();
        return 'server';
      } finally {
        busy = false;
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

    secondFactor: {
      async setUp(): Promise<TotpSetup | 'too_many' | 'server'> {
        if (session.state !== 'second_factor' || session.enrolled) return 'server';
        const id = userId;
        const mfa = client().auth.mfa;
        try {
          // an app set up but never confirmed (a reload, a closed tab) is dropped first
          const factors = await mfa.listFactors();
          if (factors.error) return authProblem(factors.error) ?? 'server';
          for (const f of factors.data.all) {
            if (f.factor_type !== 'totp' || f.status === 'verified') continue;
            const { error } = await mfa.unenroll({ factorId: f.id });
            if (error) return authProblem(error) ?? 'server';
          }
          const { data, error } = await mfa.enroll({ factorType: 'totp', issuer: TOTP_ISSUER });
          if (error) return authProblem(error) ?? 'server';
          // signed out (or another account) meanwhile: this setup is not theirs; dropped at the next one
          if (userId !== id || session.state !== 'second_factor') return 'server';
          settingUp = data.id;
          return { qrCode: data.totp.qr_code, secret: data.totp.secret };
        } catch (e) {
          // the error only: the answer that holds the secret is never logged
          console.error('admin app setup:', e instanceof Error ? e.message : 'failed');
          return 'server';
        }
      },

      async verify(raw) {
        if (session.state !== 'second_factor' || !userId) return 'server';
        const code = raw.replace(/\s/g, '');
        // nothing to check: Auth's rate limit is not spent on a code that cannot be right
        if (!/^\d{6}$/.test(code)) return 'wrong_code';
        const id = userId;
        busy = true;
        try {
          const factorId = await factorForCode();
          if (!factorId) return 'server';
          const { error } = await client().auth.mfa.challengeAndVerify({ factorId, code });
          if (error) {
            // a refusal other than a wrong code (code only: nothing secret) leaves a trace
            if (error.code !== 'mfa_verification_failed') console.error('admin code:', error.code ?? error.status);
            return codeError(error);
          }
          return await place(id);
        } catch (e) {
          // past the code but its place could not be read: the session (aal2) stays, "try again"
          console.error('admin code:', e);
          set({ state: 'signed_out', problem: 'server' });
          return 'server';
        } finally {
          busy = false;
        }
      },
    },
  };
}
