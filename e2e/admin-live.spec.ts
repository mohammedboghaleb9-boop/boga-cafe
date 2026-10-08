import { expect, test, type Page } from '@playwright/test';
import { clippedContent, expectNoSideScroll, open } from './helpers';
import { answerCatalog, CORS, SUPABASE } from './live';

/**
 * Admin sign-in on the live-site build (VITE_DATA_MODE=supabase, port 4174): Supabase
 * Auth and the two database answers the panel asks for (is_admin(), the admin_users row)
 * are answered by the test, as the real services answer them. The account's password
 * rules, its rate limits and the real tokens are Auth's own and are not tested here.
 */
const ADMIN = { email: 'owner@example.test', password: 'right-password', id: '11111111-2222-4333-8444-555555555555' };
const OTHER = { email: 'customer@example.test', password: 'right-password', id: '66666666-7777-4888-9999-000000000000' };
const STORAGE_KEY = 'boga-admin-auth';

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
function session(user: { id: string; email: string }) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return {
    access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: user.id, role: 'authenticated', aud: 'authenticated', exp })}.signature`,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: exp,
    refresh_token: `refresh-${user.id}`,
    user: { id: user.id, aud: 'authenticated', role: 'authenticated', email: user.email, app_metadata: {}, user_metadata: {}, created_at: '2026-10-01T00:00:00Z' },
  };
}

interface Server {
  /** Auth's answer to every sign-in: by default the right password of ADMIN or OTHER signs in */
  signIn?: 'rate_limited';
  /** account ids is_admin() accepts, with their admin_users role */
  admins?: Record<string, string>;
}

/** Answers Auth, is_admin() and admin_users like Supabase; returns what the browser asked for. */
async function fakeSupabase(page: Page, server: Server = {}) {
  const admins = server.admins ?? { [ADMIN.id]: 'manager' };
  const asked: string[] = [];
  /** the account each catalog read was made as (null = a visitor) */
  const shopAs: (string | null)[] = [];
  const userOf = (auth: string | undefined) => {
    const payload = auth?.split(' ')[1]?.split('.')[1];
    return payload ? (JSON.parse(Buffer.from(payload, 'base64url').toString()) as { sub: string }).sub : null;
  };
  await page.route(`${SUPABASE}/**`, async (r) => {
    const req = r.request();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    const url = new URL(req.url());
    const json = (status: number, body: unknown) => r.fulfill({ status, headers: CORS, contentType: 'application/json', json: body });
    if (url.pathname === '/auth/v1/token') {
      asked.push('sign-in');
      if (server.signIn === 'rate_limited') return json(429, { code: 429, error_code: 'over_request_rate_limit', msg: 'Request rate limit reached' });
      const { email, password } = req.postDataJSON() as { email: string; password: string };
      const account = [ADMIN, OTHER].find((a) => a.email === email && a.password === password);
      // Auth's own answer for a wrong password and an unknown email alike
      if (!account) return json(400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
      return json(200, session(account));
    }
    if (url.pathname === '/auth/v1/logout') {
      asked.push('sign-out');
      return r.fulfill({ status: 204, headers: CORS });
    }
    const user = userOf(req.headers()['authorization']);
    if (url.pathname === '/rest/v1/rpc/is_admin') {
      asked.push('is_admin');
      return json(200, !!(user && admins[user]));
    }
    if (url.pathname === '/rest/v1/admin_users') {
      // row level security: an account reads its own row
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

  test('an admin opens the page asked for, with the sections of their role; the session is kept, then signed out', async ({ page }) => {
    const asked = await fakeSupabase(page);
    await open(page, '/admin/orders');
    await expect(page.locator('#login-email')).toBeVisible(); // signed out: the form, at the address asked for
    await signIn(page, ADMIN);
    await expect(page.getByRole('heading', { level: 1, name: 'Commandes' })).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/orders$/);
    // manager: no payments nor settings
    const nav = page.getByRole('navigation', { name: 'Panel Admin' });
    await expect(nav.getByRole('link', { name: 'Commandes' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Paiements' })).toHaveCount(0);
    await expect(page.locator('.admin-main > .notice-warn')).toContainText('pas encore les commandes');
    await expect(page.getByRole('button', { name: /démo/i })).toHaveCount(0);
    expect([...asked]).toEqual(['sign-in', 'is_admin']);

    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Commandes' })).toBeVisible();
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

  test('an account that is not an admin gets "no access" and is signed out', async ({ page }) => {
    const asked = await fakeSupabase(page);
    await open(page, '/admin');
    await signIn(page, OTHER);
    await expect(page.getByRole('heading', { level: 1, name: 'Accès refusé' })).toBeVisible();
    await expect(page.locator('.admin-side')).toHaveCount(0);
    expect([...asked]).toEqual(['sign-in', 'is_admin', 'sign-out']);
    expect(await kept(page)).toBeNull();
    await page.getByRole('button', { name: 'Se connecter avec un autre compte' }).click();
    await expect(page.locator('#login-email')).toBeVisible();
  });

  test('a kept session of an account that lost its admin row is signed out on the next visit', async ({ page }) => {
    await page.addInitScript(([k, v]) => localStorage.getItem(k) ?? localStorage.setItem(k, v), [STORAGE_KEY, JSON.stringify(session(ADMIN))]);
    const asked = await fakeSupabase(page, { admins: {} });
    await open(page, '/admin');
    await expect(page.getByRole('heading', { level: 1, name: 'Accès refusé' })).toBeVisible();
    expect(asked).toContain('sign-out');
  });

  for (const [locale, title, denied] of [
    ['ar-MA', 'الدخول إلى لوحة الإدارة', 'لا يوجد وصول'],
    ['en-US', 'Sign in to the Admin Panel', 'No access'],
  ] as const) {
    test.describe(`320px ${locale}`, () => {
      test.use({ viewport: { width: 320, height: 720 }, locale });

      test('the sign-in form, its error and "no access" fit a phone', async ({ page }) => {
        await fakeSupabase(page);
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
      });
    });
  }
});
