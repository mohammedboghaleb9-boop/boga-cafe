import { expect, test, type Page } from '@playwright/test';
import { clippedContent, expectNoSideScroll, open, scanA11y } from './helpers';
import { answerCatalog, CORS, SUPABASE } from './live';

/**
 * Admin sign-in on the live-site build (VITE_DATA_MODE=supabase, port 4174): Supabase
 * Auth (password, then the authenticator app's code: MFA TOTP) and the two database
 * answers the panel asks for (the account's admin_users row, is_admin() true only at aal2)
 * are answered by the test, as the real services answer them. The account's password
 * rules, Auth's rate limits, the real tokens and real TOTP codes are Auth's own and are
 * not tested here: RIGHT_CODE stands for "the code the app shows now".
 */
const ADMIN = { email: 'owner@example.test', password: 'right-password', id: '11111111-2222-4333-8444-555555555555' };
const OTHER = { email: 'customer@example.test', password: 'right-password', id: '66666666-7777-4888-9999-000000000000' };
const STORAGE_KEY = 'boga-admin-auth';
const RIGHT_CODE = '246810';
const SECRET = 'KRUGS4ZANFZSAYJAONSWG4TFOQQGC3TE';

type Aal = 'aal1' | 'aal2';
interface Factor {
  id: string;
  status: 'verified' | 'unverified';
}

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
function session(user: { id: string; email: string }, aal: Aal = 'aal1', factors: Factor[] = []) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return {
    access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: user.id, role: 'authenticated', aud: 'authenticated', exp, aal })}.${Buffer.from('not checked by the site').toString('base64url')}`,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: exp,
    refresh_token: `refresh-${user.id}`,
    user: userJson(user, factors),
  };
}
function userJson(user: { id: string; email: string }, factors: Factor[]) {
  return {
    id: user.id, aud: 'authenticated', role: 'authenticated', email: user.email, app_metadata: {}, user_metadata: {}, created_at: '2026-10-01T00:00:00Z',
    factors: factors.map((f) => ({ ...f, factor_type: 'totp', friendly_name: '', created_at: '', updated_at: '' })),
  };
}

interface Server {
  /** Auth's answer to every sign-in: by default the right password of ADMIN or OTHER signs in */
  signIn?: 'rate_limited';
  /** account ids is_admin() accepts at aal2, with their admin_users role */
  admins?: Record<string, string>;
  /** ADMIN's authenticator apps: one set up by default */
  factors?: Factor[];
}

/** Answers Auth (password and TOTP), is_admin() and admin_users like Supabase; returns what the browser asked for. */
async function fakeSupabase(page: Page, server: Server = {}) {
  const admins = server.admins ?? { [ADMIN.id]: 'manager' };
  let factors = server.factors ?? [{ id: 'app-1', status: 'verified' }];
  const asked: string[] = [];
  /** the account each catalog read was made as (null = a visitor) */
  const shopAs: (string | null)[] = [];
  const claimsOf = (auth: string | undefined) => {
    const payload = auth?.split(' ')[1]?.split('.')[1];
    return payload ? (JSON.parse(Buffer.from(payload, 'base64url').toString()) as { sub: string; aal: Aal }) : null;
  };
  const accountOf = (id: string) => [ADMIN, OTHER].find((a) => a.id === id)!;
  await page.route(`${SUPABASE}/**`, async (r) => {
    const req = r.request();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    const url = new URL(req.url());
    const json = (status: number, body: unknown) => r.fulfill({ status, headers: CORS, contentType: 'application/json', json: body });
    const claims = claimsOf(req.headers()['authorization']);
    const user = claims?.sub ?? null;
    const mine = (id: string) => (id === ADMIN.id ? factors : []);
    if (url.pathname === '/auth/v1/token') {
      asked.push('sign-in');
      if (server.signIn === 'rate_limited') return json(429, { code: 429, error_code: 'over_request_rate_limit', msg: 'Request rate limit reached' });
      const { email, password } = req.postDataJSON() as { email: string; password: string };
      const account = [ADMIN, OTHER].find((a) => a.email === email && a.password === password);
      // Auth's own answer for a wrong password and an unknown email alike
      if (!account) return json(400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
      return json(200, session(account, 'aal1', mine(account.id)));
    }
    if (url.pathname === '/auth/v1/logout') {
      asked.push('sign-out');
      return r.fulfill({ status: 204, headers: CORS });
    }
    if (url.pathname === '/auth/v1/user' && user) return json(200, userJson(accountOf(user), mine(user)));
    const factor = url.pathname.match(/^\/auth\/v1\/factors(?:\/([^/]+))?(?:\/(challenge|verify))?$/);
    if (factor && user) {
      const [, id, step] = factor;
      if (!id) {
        asked.push('set-up');
        factors = [...factors, { id: 'app-new', status: 'unverified' }];
        return json(200, { id: 'app-new', type: 'totp', friendly_name: '', totp: { qr_code: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>', secret: SECRET, uri: 'otpauth://totp/x' } });
      }
      if (req.method() === 'DELETE') {
        asked.push(`drop ${id}`);
        factors = factors.filter((f) => f.id !== id);
        return json(200, { id });
      }
      if (step === 'challenge') return json(200, { id: `challenge-${id}`, type: 'totp', expires_at: Math.floor(Date.now() / 1000) + 300 });
      asked.push('code');
      const { code } = req.postDataJSON() as { code: string };
      if (code !== RIGHT_CODE) return json(422, { code: 422, error_code: 'mfa_verification_failed', msg: 'Invalid TOTP code entered' });
      factors = factors.map((f) => (f.id === id ? { ...f, status: 'verified' } : f));
      return json(200, session(accountOf(user), 'aal2', mine(user)));
    }
    if (url.pathname === '/rest/v1/rpc/is_admin') {
      asked.push('is_admin');
      // the database's rule (migration 20261008154205): an admin, and the second factor passed
      return json(200, !!(user && admins[user] && claims?.aal === 'aal2'));
    }
    if (url.pathname === '/rest/v1/admin_users') {
      // row level security: an account reads its own row, at any level
      const own = user && url.searchParams.get('user_id') === `eq.${user}` && admins[user] ? { role: admins[user] } : null;
      const single = (req.headers()['accept'] ?? '').includes('vnd.pgrst.object');
      return json(200, single ? own : own ? [own] : []);
    }
    shopAs.push(user);
    return answerCatalog(r);
  });
  return Object.assign(asked, { shopAs });
}

async function signIn(page: Page, account: { email: string; password: string }) {
  await page.fill('#login-email', account.email);
  await page.fill('#login-password', account.password);
  await page.locator('form button[type=submit]').click();
}
async function enterCode(page: Page, code: string) {
  await page.fill('#factor-code', code);
  await page.locator('form button[type=submit]').click();
}
const kept = (page: Page) => page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY);

test.describe('admin sign-in on the live site', () => {
  test('a wrong password and an unknown email get the same answer; too many attempts are said so', async ({ page }) => {
    await fakeSupabase(page);
    await open(page, '/admin');
    await expect(page.locator('#login-role')).toHaveCount(0); // no prototype role picker
    await signIn(page, { email: ADMIN.email, password: 'wrong' });
    const alert = page.locator('#login-error');
    await expect(alert).toHaveText('E-mail ou mot de passe incorrect.');
    await expect(page.locator('#login-password')).toHaveValue('');
    await signIn(page, { email: 'nobody@example.test', password: 'whatever' });
    await expect(alert).toHaveText('E-mail ou mot de passe incorrect.');
    expect(await kept(page)).toBeNull();

    const limited = await page.context().newPage();
    await fakeSupabase(limited, { signIn: 'rate_limited' });
    await open(limited, '/admin');
    await signIn(limited, ADMIN);
    await expect(limited.locator('#login-error')).toContainText('Trop de tentatives');
  });

  test('an admin gives the app code after the password, then opens the page asked for; the session is kept, then signed out', async ({ page }) => {
    const asked = await fakeSupabase(page);
    await open(page, '/admin/orders');
    await expect(page.locator('#login-email')).toBeVisible(); // signed out: the form, at the address asked for
    await signIn(page, ADMIN);
    await expect(page.getByRole('heading', { level: 1, name: 'Vérification en deux étapes' })).toBeVisible();
    await expect(page.locator('.totp-qr')).toHaveCount(0); // the app is set up already: the code only
    expect([...asked]).toEqual(['sign-in']); // the database is not asked at aal1

    await enterCode(page, '135799');
    await expect(page.locator('#factor-error')).toHaveText('Code incorrect ou expiré. Entrez le code affiché maintenant par l’application.');
    await expect(page.locator('#factor-code')).toHaveValue('');
    await expect(page.locator('#factor-code')).toBeFocused();
    await scanA11y(page, 'code refused');
    await enterCode(page, RIGHT_CODE);
    await expect(page.getByRole('heading', { level: 1, name: 'Commandes' })).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/orders$/);
    expect([...asked]).toEqual(['sign-in', 'code', 'code', 'is_admin']);
    // manager: no payments nor settings
    const nav = page.getByRole('navigation', { name: 'Panel Admin' });
    await expect(nav.getByRole('link', { name: 'Commandes' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Paiements' })).toHaveCount(0);
    await expect(page.locator('.admin-main > .notice-warn')).toContainText('pas encore les commandes');
    await expect(page.getByRole('button', { name: /démo/i })).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Commandes' })).toBeVisible(); // aal2 kept: no code again
    expect(await kept(page)).toContain(ADMIN.id);

    // the shop, in the same browser, still reads as a visitor (an admin would see inactive products)
    asked.shopAs.length = 0;
    await open(page, '/shop');
    await expect(page.getByText('BOGA Signature').first()).toBeVisible();
    expect(asked.shopAs.length).toBeGreaterThan(0);
    expect(asked.shopAs.filter(Boolean)).toEqual([]);
    await open(page, '/admin/orders');

    await page.getByRole('button', { name: 'Déconnexion' }).click();
    await expect(page.locator('#login-email')).toBeVisible();
    expect(asked).toContain('sign-out');
    expect(await kept(page)).toBeNull();
    await page.reload();
    await expect(page.locator('#login-email')).toBeVisible();
  });

  test('an admin with no app sets it up (QR code and key, shown once), and its first code opens the panel', async ({ page }) => {
    const logged: string[] = [];
    page.on('console', (m) => logged.push(m.text()));
    const asked = await fakeSupabase(page, { admins: { [ADMIN.id]: 'owner' }, factors: [{ id: 'app-old', status: 'unverified' }] });
    await open(page, '/admin');
    await signIn(page, ADMIN);
    await expect(page.getByRole('heading', { level: 1, name: 'Vérification en deux étapes' })).toBeVisible();
    await expect(page.locator('#factor-code')).toHaveCount(0); // nothing to type before the app exists
    await page.getByRole('button', { name: 'Configurer l’application' }).click();
    await expect(page.getByRole('img', { name: 'QR code à scanner avec l’application d’authentification' })).toBeVisible();
    await expect(page.locator('.totp-key')).toHaveText(SECRET.match(/.{4}/g)!.join(' '));
    expect([...asked]).toEqual(['sign-in', 'drop app-old', 'set-up']); // the unfinished setup is dropped first
    expect(JSON.stringify(await page.evaluate(() => ({ ...localStorage, ...sessionStorage })))).not.toContain(SECRET);
    await scanA11y(page, 'app setup');

    await enterCode(page, RIGHT_CODE);
    await expect(page.getByRole('heading', { level: 1, name: 'Tableau de bord' })).toBeVisible();
    await expect(page.locator('.totp-key')).toHaveCount(0);
    expect(JSON.stringify(await page.evaluate(() => ({ ...localStorage, ...sessionStorage })))).not.toContain(SECRET);
    expect(logged.join('\n')).not.toContain(SECRET);
  });

  test('a session that stopped after the password reopens on the code, never the panel', async ({ page }) => {
    await page.addInitScript(([k, v]) => localStorage.getItem(k) ?? localStorage.setItem(k, v), [STORAGE_KEY, JSON.stringify(session(ADMIN, 'aal1', [{ id: 'app-1', status: 'verified' }]))]);
    const asked = await fakeSupabase(page);
    await open(page, '/admin/orders');
    await expect(page.locator('#factor-code')).toBeVisible();
    await expect(page.locator('.admin-side')).toHaveCount(0);
    expect(asked).not.toContain('is_admin');
    await page.getByRole('button', { name: 'Déconnexion' }).click();
    await expect(page.locator('#login-email')).toBeVisible();
    expect(await kept(page)).toBeNull();
  });

  test('an account that is not an admin gets "no access" at once (no code asked) and is signed out', async ({ page }) => {
    const asked = await fakeSupabase(page);
    await open(page, '/admin');
    await signIn(page, OTHER);
    await expect(page.getByRole('heading', { level: 1, name: 'Accès refusé' })).toBeVisible();
    await expect(page.locator('.admin-side')).toHaveCount(0);
    expect([...asked]).toEqual(['sign-in', 'sign-out']);
    expect(await kept(page)).toBeNull();
    await page.getByRole('button', { name: 'Se connecter avec un autre compte' }).click();
    await expect(page.locator('#login-email')).toBeVisible();
  });

  test('a kept session of an account that lost its admin row is signed out on the next visit', async ({ page }) => {
    await page.addInitScript(([k, v]) => localStorage.getItem(k) ?? localStorage.setItem(k, v), [STORAGE_KEY, JSON.stringify(session(ADMIN, 'aal2'))]);
    const asked = await fakeSupabase(page, { admins: {} });
    await open(page, '/admin');
    await expect(page.getByRole('heading', { level: 1, name: 'Accès refusé' })).toBeVisible();
    expect(asked).toContain('sign-out');
  });

  for (const [locale, title, denied, setUp] of [
    ['ar-MA', 'الدخول إلى لوحة الإدارة', 'لا يوجد وصول', 'إعداد التطبيق'],
    ['en-US', 'Sign in to the Admin Panel', 'No access', 'Set up the app'],
  ] as const) {
    test.describe(`320px ${locale}`, () => {
      test.use({ viewport: { width: 320, height: 720 }, locale });

      test('the sign-in form, its error, "no access" and the app setup fit a phone', async ({ page }) => {
        await fakeSupabase(page, { factors: [] });
        await open(page, '/admin');
        await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
        await signIn(page, { email: ADMIN.email, password: 'wrong' });
        await expect(page.locator('#login-error')).toBeVisible();
        await expectNoSideScroll(page);
        expect(await clippedContent(page)).toEqual([]);
        await signIn(page, OTHER);
        await expect(page.getByRole('heading', { level: 1, name: denied })).toBeVisible();
        await expectNoSideScroll(page);
        expect(await clippedContent(page)).toEqual([]);
        await page.locator('.admin-login-card .btn-primary').click();
        await signIn(page, ADMIN);
        await page.getByRole('button', { name: setUp }).click();
        await expect(page.locator('.totp-key')).toBeVisible();
        await enterCode(page, '000000');
        await expect(page.locator('#factor-error')).toBeVisible();
        await expectNoSideScroll(page);
        expect(await clippedContent(page)).toEqual([]);
      });
    });
  }
});
