/**
 * Admin sign-in on the live site: who gets in (an account is_admin() accepts, with
 * its role), what the form may say (one answer for every refused email or password),
 * and what a kept session becomes on the next visit.
 */
import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminSession } from '../../types';
import { createAdminAuth } from '../adminAuth';
import type { Client } from '../client';

const USER = 'c5f75f59-d8cc-4e9b-abb1-b1062867d558';

interface Fake {
  /** what Auth answers to the email and password */
  signIn?: { error: Error } | 'ok';
  /** the session kept in this browser */
  kept?: boolean;
  isAdmin?: boolean | Error;
  role?: string | null;
  /** supabase-js could not read the kept session first (expired token, no network): signOut() keeps it */
  signOutFails?: boolean;
}

function fakeClient(f: Fake) {
  const calls: string[] = [];
  let onChange: ((event: string, s: { user: { id: string } } | null) => void) | undefined;
  const user = { id: USER };
  const auth = {
    signInWithPassword: vi.fn(async () =>
      f.signIn === 'ok' || f.signIn === undefined ? { data: { user, session: {} }, error: null } : { data: { user: null, session: null }, error: f.signIn.error },
    ),
    getSession: vi.fn(async () => ({ data: { session: f.kept ? { user } : null }, error: null })),
    signOut: vi.fn(async () => (calls.push('signOut'), { error: f.signOutFails ? new AuthRetryableFetchError('offline', 0) : null })),
    onAuthStateChange: vi.fn((cb: typeof onChange) => ((onChange = cb), { data: { subscription: { unsubscribe() {} } } })),
  };
  const client = {
    auth,
    rpc: vi.fn(async (name: string) => {
      calls.push(name);
      return f.isAdmin instanceof Error ? { data: null, error: f.isAdmin } : { data: f.isAdmin ?? true, error: null };
    }),
    from: vi.fn((table: string) => {
      const q = {
        select: () => q,
        eq: (column: string, value: string) => (calls.push(`${table}.${column}=${value}`), q),
        maybeSingle: async () => ({ data: f.role === null ? null : { role: f.role ?? 'manager' }, error: null }),
      };
      return q;
    }),
  } as unknown as Client;
  return { client, auth, calls, fire: (event: string, id?: string) => onChange?.(event, id ? { user: { id } } : null) };
}

/** The admin auth, already listened to (which starts the check of a kept session). */
async function started(f: Fake) {
  const fake = fakeClient(f);
  const forget = vi.fn();
  const admin = createAdminAuth(() => fake.client, forget);
  const seen: AdminSession[] = [];
  admin.session.subscribe(() => seen.push(admin.session.get()));
  await vi.waitFor(() => expect(admin.session.get().state).not.toBe('loading'));
  return { ...fake, admin, seen, forget };
}

const creds = { email: ' owner@example.com ', password: 'secret' };

beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

describe('admin sign-in (live site)', () => {
  it('lets an admin in with the role of their own admin_users row', async () => {
    const { admin, auth, calls } = await started({ role: 'manager' });
    expect(await admin.signIn(creds)).toBe('ok');
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: 'owner@example.com', password: 'secret' });
    expect(admin.session.get()).toEqual({ state: 'signed_in', role: 'manager' });
    expect(calls).toContain('is_admin');
    expect(calls).toContain(`admin_users.user_id=${USER}`);
  });

  it('answers the same for a wrong password, an unknown email or an unconfirmed one', async () => {
    const answers = [];
    for (const code of ['invalid_credentials', 'email_not_confirmed', 'user_banned', 'validation_failed']) {
      const { admin } = await started({ signIn: { error: new AuthApiError('refused', 400, code) } });
      answers.push(await admin.signIn(creds));
      expect(admin.session.get().state).toBe('signed_out');
    }
    expect(answers).toEqual(['credentials', 'credentials', 'credentials', 'credentials']);
  });

  it('says "too many attempts" on Auth\'s rate limit, and "connection" when Auth cannot be reached', async () => {
    expect(await (await started({ signIn: { error: new AuthApiError('slow down', 429, 'over_request_rate_limit') } })).admin.signIn(creds)).toBe('too_many');
    expect(await (await started({ signIn: { error: new AuthRetryableFetchError('offline', 0) } })).admin.signIn(creds)).toBe('server');
    expect(await (await started({ signIn: { error: new AuthApiError('down', 503, 'unexpected_failure') } })).admin.signIn(creds)).toBe('server');
  });

  it('signs out again an account that is not an admin, and shows "no access" until dismissed', async () => {
    for (const notAdmin of [{ isAdmin: false }, { isAdmin: true, role: null }, { isAdmin: true, role: 'root' }] as Fake[]) {
      const { admin, calls } = await started(notAdmin);
      expect(await admin.signIn(creds)).toBe('denied');
      expect(admin.session.get()).toEqual({ state: 'denied' });
      expect(calls).toContain('signOut');
      admin.dismiss();
      expect(admin.session.get()).toEqual({ state: 'signed_out' });
    }
  });

  it('is never left half signed in when the role cannot be read', async () => {
    const { admin, calls } = await started({ isAdmin: new Error('network down') });
    expect(await admin.signIn(creds)).toBe('server');
    expect(admin.session.get().state).toBe('signed_out');
    expect(calls).toContain('signOut');
  });

  it('signs out this browser only', async () => {
    const { admin, auth, forget } = await started({ kept: true, role: 'owner' });
    expect(admin.session.get()).toEqual({ state: 'signed_in', role: 'owner' });
    await admin.signOut();
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(admin.session.get()).toEqual({ state: 'signed_out' });
    expect(forget).not.toHaveBeenCalled();
  });

  it('removes the kept session itself when supabase-js cannot (expired token, no network)', async () => {
    const out = await started({ kept: true, role: 'owner', signOutFails: true });
    await out.admin.signOut();
    expect(out.forget).toHaveBeenCalled();
    const denied = await started({ isAdmin: false, signOutFails: true });
    expect(await denied.admin.signIn(creds)).toBe('denied');
    expect(denied.forget).toHaveBeenCalled();
  });

  it('does not send an empty form to Auth (its rate limit is not spent)', async () => {
    const { admin, auth } = await started({});
    expect(await admin.signIn({ email: '  ', password: 'secret' })).toBe('credentials');
    expect(await admin.signIn({ email: 'owner@example.com', password: '' })).toBe('credentials');
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });
});

describe('kept session (next visit)', () => {
  it('opens the panel for an admin, and the form when there is none', async () => {
    expect((await started({ kept: true, role: 'staff' })).admin.session.get()).toEqual({ state: 'signed_in', role: 'staff' });
    const none = await started({ kept: false });
    expect(none.admin.session.get()).toEqual({ state: 'signed_out' });
    expect(none.calls).toEqual([]); // no session: the database is not asked
  });

  it('signs out a kept session whose account is no longer an admin', async () => {
    const { admin, calls } = await started({ kept: true, isAdmin: false });
    expect(admin.session.get()).toEqual({ state: 'denied' });
    expect(calls).toContain('signOut');
  });

  it('keeps the session when the check gets no answer, and says so', async () => {
    const { admin, calls } = await started({ kept: true, isAdmin: new Error('network down') });
    expect(admin.session.get()).toEqual({ state: 'signed_out', problem: 'server' });
    expect(calls).not.toContain('signOut');
  });

  it('checks again an account signed in from another tab, not its own sign-in', async () => {
    const f: Fake = { kept: true, role: 'owner' };
    const { admin, fire, calls, client } = await started(f);
    const asked = () => calls.filter((c) => c === 'is_admin').length;
    expect(asked()).toBe(1);
    fire('SIGNED_IN', USER); // the same account (a refresh, a focus): nothing to check
    await new Promise((r) => setTimeout(r, 5));
    expect(asked()).toBe(1);
    f.role = 'staff';
    fire('SIGNED_IN', '99999999-0000-4000-8000-000000000000'); // another tab, another admin
    await vi.waitFor(() => expect(admin.session.get()).toEqual({ state: 'signed_in', role: 'staff' }));
    // our own sign-in fires SIGNED_IN too: checked once, by the sign-in itself
    vi.mocked(client.auth.signInWithPassword).mockImplementationOnce(async () => {
      fire('SIGNED_IN', '77777777-0000-4000-8000-000000000000');
      return { data: { user: { id: '77777777-0000-4000-8000-000000000000' }, session: {} }, error: null } as never;
    });
    const before = asked();
    expect(await admin.signIn(creds)).toBe('ok');
    await new Promise((r) => setTimeout(r, 5));
    expect(asked()).toBe(before + 1);
  });

  it('checks the kept session again on "try again"', async () => {
    const f: Fake = { kept: true, isAdmin: new Error('network down') };
    const { admin } = await started(f);
    expect(admin.session.get()).toEqual({ state: 'signed_out', problem: 'server' });
    f.isAdmin = true;
    admin.retry();
    await vi.waitFor(() => expect(admin.session.get()).toEqual({ state: 'signed_in', role: 'manager' }));
  });

  it('goes back to the form when Auth signs the session out (refresh refused, other tab)', async () => {
    const { admin, fire } = await started({ kept: true, role: 'owner' });
    fire('TOKEN_REFRESHED');
    expect(admin.session.get().state).toBe('signed_in');
    fire('SIGNED_OUT');
    expect(admin.session.get()).toEqual({ state: 'signed_out' });
  });

  it('starts no Auth client for a visitor who never opens the panel', () => {
    const make = vi.fn();
    const admin = createAdminAuth(make, vi.fn());
    expect(admin.session.get()).toEqual({ state: 'loading' });
    expect(make).not.toHaveBeenCalled();
  });
});
