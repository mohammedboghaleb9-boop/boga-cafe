/**
 * Admin sign-in on the live site: who gets in (an admin_users account, past its password
 * and the authenticator app's code, that is_admin() accepts at aal2), what the forms may
 * say (one answer for every refused password, one for every refused code), and what a
 * kept session becomes on the next visit.
 */
import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminSession } from '../../types';
import { createAdminAuth } from '../adminAuth';
import type { Client } from '../client';

const USER = 'c5f75f59-d8cc-4e9b-abb1-b1062867d558';
const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

interface Factor {
  id: string;
  status: 'verified' | 'unverified';
}

interface Fake {
  /** what Auth answers to the email and password */
  signIn?: { error: Error } | 'ok';
  /** the session kept in this browser */
  kept?: boolean;
  /** the session's level: aal1 after the password, aal2 once a code was accepted */
  aal?: 'aal1' | 'aal2';
  /** the account's authenticator apps (unverified = a setup never finished) */
  factors?: Factor[];
  /** what Auth answers to a code */
  verify?: { error: Error };
  isAdmin?: boolean | Error;
  /** the account's own admin_users row */
  role?: string | null | Error;
  /** supabase-js could not read the kept session first (expired token, no network): signOut() keeps it */
  signOutFails?: boolean;
}

function fakeClient(f: Fake) {
  const calls: string[] = [];
  let onChange: ((event: string, s: { user: { id: string } } | null) => void) | undefined;
  const user = { id: USER };
  f.factors ??= [];
  const totp = (all: Factor[]) => all.map((x) => ({ ...x, factor_type: 'totp' }));
  const mfa = {
    getAuthenticatorAssuranceLevel: vi.fn(async () => ({ data: { currentLevel: f.aal ?? 'aal1', nextLevel: 'aal2', currentAuthenticationMethods: [] }, error: null })),
    listFactors: vi.fn(async () => {
      calls.push('listFactors');
      const all = totp(f.factors!);
      return { data: { all, totp: all.filter((x) => x.status === 'verified') }, error: null };
    }),
    unenroll: vi.fn(async ({ factorId }: { factorId: string }) => {
      calls.push(`unenroll ${factorId}`);
      f.factors = f.factors!.filter((x) => x.id !== factorId);
      return { data: { id: factorId }, error: null };
    }),
    enroll: vi.fn(async () => {
      calls.push('enroll');
      f.factors!.push({ id: 'new-factor', status: 'unverified' });
      return { data: { id: 'new-factor', type: 'totp', totp: { qr_code: 'data:image/svg+xml;utf-8,<svg/>', secret: SECRET, uri: 'otpauth://totp/x' } }, error: null };
    }),
    challengeAndVerify: vi.fn(async ({ factorId, code }: { factorId: string; code: string }) => {
      calls.push(`code ${factorId} ${code}`);
      if (f.verify) return { data: null, error: f.verify.error };
      f.aal = 'aal2';
      f.factors = f.factors!.map((x) => (x.id === factorId ? { ...x, status: 'verified' as const } : x));
      return { data: {}, error: null };
    }),
  };
  const auth = {
    mfa,
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
        maybeSingle: async () =>
          f.role instanceof Error ? { data: null, error: f.role } : { data: f.role === null ? null : { role: f.role ?? 'manager' }, error: null },
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
  return { ...fake, admin, seen, forget, mfa: admin.secondFactor! };
}

const creds = { email: ' owner@example.com ', password: 'secret' };
const withApp = (): Factor[] => [{ id: 'app', status: 'verified' }];

beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

describe('admin sign-in (live site)', () => {
  it('asks an admin for the app code after the password, then opens the panel at aal2 with its role', async () => {
    const { admin, auth, calls, mfa } = await started({ role: 'manager', factors: withApp() });
    expect(await admin.signIn(creds)).toBe('ok');
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: 'owner@example.com', password: 'secret' });
    expect(admin.session.get()).toEqual({ state: 'second_factor', enrolled: true });
    expect(calls).toContain(`admin_users.user_id=${USER}`);
    expect(calls).not.toContain('is_admin'); // at aal1 the database is not asked
    expect(await mfa.verify('123 456')).toBe('ok');
    expect(calls).toContain('code app 123456');
    expect(calls).toContain('is_admin');
    expect(admin.session.get()).toEqual({ state: 'signed_in', role: 'manager' });
  });

  it('sets up the app of an account that has none: QR code and secret once, never kept, then its first code', async () => {
    const { admin, calls, mfa } = await started({ role: 'owner', factors: [{ id: 'unfinished', status: 'unverified' }] });
    expect(await admin.signIn(creds)).toBe('ok');
    expect(admin.session.get()).toEqual({ state: 'second_factor', enrolled: false });
    expect(await mfa.setUp()).toEqual({ qrCode: 'data:image/svg+xml;utf-8,<svg/>', secret: SECRET });
    expect(calls.slice(0, calls.indexOf('enroll'))).toContain('unenroll unfinished'); // the unfinished setup is dropped first
    expect(JSON.stringify(admin.session.get())).not.toContain(SECRET);
    expect(await mfa.verify('654321')).toBe('ok');
    expect(calls).toContain('code new-factor 654321');
    expect(admin.session.get()).toEqual({ state: 'signed_in', role: 'owner' });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(SECRET);
  });

  it('forgets a setup left by a sign-out: the next admin\'s code goes to its own app', async () => {
    const f: Fake = { role: 'owner' };
    const { admin, mfa, calls } = await started(f);
    await admin.signIn(creds);
    const setting = mfa.setUp();
    await admin.signOut(); // while the setup is on its way
    expect(await setting).toBe('server');
    f.factors = withApp();
    await admin.signIn(creds);
    expect(await mfa.verify('123456')).toBe('ok');
    expect(calls).toContain('code app 123456');
  });

  it('answers the same for a wrong, expired or unknown code; a code that cannot be right never reaches Auth', async () => {
    const answers = [];
    for (const error of [
      new AuthApiError('Invalid TOTP code entered', 422, 'mfa_verification_failed'),
      new AuthApiError('challenge expired', 422, 'mfa_challenge_expired'),
      new AuthApiError('factor not found', 404, 'mfa_factor_not_found'),
    ]) {
      const { admin, mfa } = await started({ factors: withApp(), verify: { error } });
      await admin.signIn(creds);
      answers.push(await mfa.verify('123456'));
      expect(admin.session.get()).toEqual({ state: 'second_factor', enrolled: true });
    }
    expect(answers).toEqual(['wrong_code', 'wrong_code', 'wrong_code']);
    const limited = await started({ factors: withApp(), verify: { error: new AuthApiError('slow down', 429, 'over_request_rate_limit') } });
    await limited.admin.signIn(creds);
    expect(await limited.mfa.verify('123456')).toBe('too_many');
    const offline = await started({ factors: withApp(), verify: { error: new AuthRetryableFetchError('offline', 0) } });
    await offline.admin.signIn(creds);
    expect(await offline.mfa.verify('123456')).toBe('server');
    const { admin, auth, mfa } = await started({ factors: withApp() });
    await admin.signIn(creds);
    expect(await mfa.verify('12345')).toBe('wrong_code');
    expect(await mfa.verify('12345a')).toBe('wrong_code');
    expect(auth.mfa.challengeAndVerify).not.toHaveBeenCalled();
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

  it('signs out at once an account with no admin row (no code asked), and one the database refuses at aal2', async () => {
    for (const role of [null, 'root']) {
      const { admin, calls, auth } = await started({ role });
      expect(await admin.signIn(creds)).toBe('denied');
      expect(admin.session.get()).toEqual({ state: 'denied' });
      expect(calls).toContain('signOut');
      expect(auth.mfa.listFactors).not.toHaveBeenCalled();
      admin.dismiss();
      expect(admin.session.get()).toEqual({ state: 'signed_out' });
    }
    const { admin, calls, mfa } = await started({ factors: withApp(), isAdmin: false });
    await admin.signIn(creds);
    expect(await mfa.verify('123456')).toBe('denied');
    expect(admin.session.get()).toEqual({ state: 'denied' });
    expect(calls).toContain('signOut');
  });

  it('is never left half signed in when its admin row cannot be read', async () => {
    const { admin, calls } = await started({ role: new Error('network down') });
    expect(await admin.signIn(creds)).toBe('server');
    expect(admin.session.get().state).toBe('signed_out');
    expect(calls).toContain('signOut');
  });

  it('signs out this browser only, from the panel or from the code step', async () => {
    const { admin, auth, forget } = await started({ kept: true, aal: 'aal2', role: 'owner' });
    expect(admin.session.get()).toEqual({ state: 'signed_in', role: 'owner' });
    await admin.signOut();
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(admin.session.get()).toEqual({ state: 'signed_out' });
    expect(forget).not.toHaveBeenCalled();
    const step = await started({ kept: true, factors: withApp() });
    await step.admin.signOut();
    expect(step.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(step.admin.session.get()).toEqual({ state: 'signed_out' });
  });

  it('removes the kept session itself when supabase-js cannot (expired token, no network)', async () => {
    const out = await started({ kept: true, aal: 'aal2', role: 'owner', signOutFails: true });
    await out.admin.signOut();
    expect(out.forget).toHaveBeenCalled();
    const denied = await started({ role: null, signOutFails: true });
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
  it('opens the panel at aal2, the code step at aal1 (never the panel), and the form when there is none', async () => {
    expect((await started({ kept: true, aal: 'aal2', role: 'staff' })).admin.session.get()).toEqual({ state: 'signed_in', role: 'staff' });
    const halfway = await started({ kept: true, aal: 'aal1', role: 'owner', factors: withApp() });
    expect(halfway.admin.session.get()).toEqual({ state: 'second_factor', enrolled: true });
    expect(halfway.calls).not.toContain('is_admin');
    const none = await started({ kept: false });
    expect(none.admin.session.get()).toEqual({ state: 'signed_out' });
    expect(none.calls).toEqual([]); // no session: the database is not asked
  });

  it('signs out a kept session whose account is no longer an admin', async () => {
    for (const f of [{ role: null }, { aal: 'aal2', isAdmin: false }] as Fake[]) {
      const { admin, calls } = await started({ kept: true, ...f });
      expect(admin.session.get()).toEqual({ state: 'denied' });
      expect(calls).toContain('signOut');
    }
  });

  it('keeps the session when the check gets no answer, and says so; "try again" checks it again', async () => {
    const f: Fake = { kept: true, aal: 'aal2', role: new Error('network down') };
    const { admin, calls } = await started(f);
    expect(admin.session.get()).toEqual({ state: 'signed_out', problem: 'server' });
    expect(calls).not.toContain('signOut');
    f.role = 'manager';
    admin.retry();
    await vi.waitFor(() => expect(admin.session.get()).toEqual({ state: 'signed_in', role: 'manager' }));
  });

  it('checks again after another tab signs in or passes the code, not after its own sign-in', async () => {
    const f: Fake = { kept: true, aal: 'aal1', role: 'owner', factors: withApp() };
    const { admin, fire, calls, client } = await started(f);
    const placed = () => calls.filter((c) => c.startsWith('admin_users.')).length;
    expect(placed()).toBe(1);
    fire('SIGNED_IN', USER); // the same account (a refresh, a focus): nothing to check
    await new Promise((r) => setTimeout(r, 5));
    expect(placed()).toBe(1);
    f.aal = 'aal2'; // another tab entered the code
    fire('MFA_CHALLENGE_VERIFIED', USER);
    await vi.waitFor(() => expect(admin.session.get()).toEqual({ state: 'signed_in', role: 'owner' }));
    f.role = 'staff';
    fire('SIGNED_IN', '99999999-0000-4000-8000-000000000000'); // another tab, another admin
    await vi.waitFor(() => expect(admin.session.get()).toEqual({ state: 'signed_in', role: 'staff' }));
    // our own sign-in fires SIGNED_IN too: placed once, by the sign-in itself
    vi.mocked(client.auth.signInWithPassword).mockImplementationOnce(async () => {
      fire('SIGNED_IN', '77777777-0000-4000-8000-000000000000');
      return { data: { user: { id: '77777777-0000-4000-8000-000000000000' }, session: {} }, error: null } as never;
    });
    const before = placed();
    expect(await admin.signIn(creds)).toBe('ok');
    await new Promise((r) => setTimeout(r, 5));
    expect(placed()).toBe(before + 1);
  });

  it('goes back to the form when Auth signs the session out (refresh refused, other tab)', async () => {
    for (const f of [{ aal: 'aal2', role: 'owner' }, { aal: 'aal1', factors: withApp() }] as Fake[]) {
      const { admin, fire } = await started({ kept: true, ...f });
      fire('TOKEN_REFRESHED');
      expect(admin.session.get().state).not.toBe('signed_out');
      fire('SIGNED_OUT');
      expect(admin.session.get()).toEqual({ state: 'signed_out' });
    }
  });

  it('starts no Auth client for a visitor who never opens the panel', () => {
    const make = vi.fn();
    const admin = createAdminAuth(make, vi.fn());
    expect(admin.session.get()).toEqual({ state: 'loading' });
    expect(make).not.toHaveBeenCalled();
  });
});
