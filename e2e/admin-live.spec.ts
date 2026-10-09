import { expect, test, type Page } from '@playwright/test';
import { clippedContent, expectNoSideScroll, open, scanA11y } from './helpers';
import { answerCatalog, CORS, SUPABASE, tables } from './live';

/**
 * Admin sign-in on the live-site build (VITE_DATA_MODE=supabase, port 4174): Supabase
 * Auth (password, then the authenticator app's code: MFA TOTP) and the database answers
 * the panel asks for (the account's admin_users row, is_admin() true only at aal2, the
 * admin tables that row level security opens only to such a session: slice 7, and the
 * write functions: slices 8-9) are answered by the test, as the real services answer them. The account's password
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

/** A customer's details, as the admin tables hold them: shown in the panel, never kept in the browser. */
const CUSTOMER = { name: 'Amina E2E', phone: '0611223344' };
const ORDER_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const L = (s: string) => ({ ar: s, fr: s, en: s });
/** The tables only an admin at aal2 reads (row level security). */
const ADMIN_TABLES: Record<string, unknown[]> = {
  orders: [
    { id: ORDER_ID, number: 'BC-2026-0007', created_at: '2026-10-08T09:00:00Z', locale: 'fr', customer_name: CUSTOMER.name, phone: CUSTOMER.phone, email: '',
      city_id: 'oujda', address: 'Rue 7', company: '', notes: '', weight_kg: '0.250', subtotal: '65.00', shipping_fee: '20.00', total: '85.00',
      lines: [{ productId: 'boga-signature', name: L('BOGA Signature'), size: 250, qty: 1, unitPrice: 65, lineTotal: 65, composition: [{ originId: 'brazil', percent: 100, grams: 250 }] }],
      payment_method: 'cashplus', payment_status: 'awaiting_verification', payment_ref: 'CP-123', status: 'new',
      stock_deductions: [{ originId: 'brazil', kg: 0.25 }], stock_returned: false,
      order_events: [{ at: '2026-10-08T10:00:00Z', label: 'payment.reported' }, { at: '2026-10-08T09:00:00Z', label: 'order.created' }] },
  ],
  quote_requests: [
    { id: 'quote-1', number: 'QR-2026-0003', created_at: '2026-10-08T08:00:00Z', business_type: 'cafe', company: 'Café E2E', contact_name: CUSTOMER.name,
      phone: CUSTOMER.phone, email: '', city_id: 'oujda', lines: [], weight_kg: '30.000', indicative_total: '6000.00', notes: '', status: 'new', final_price: null, admin_notes: '',
      updated_at: '2026-10-08T08:00:00.000001+00:00', updated_by: null },
  ],
  stock_movements: [{ id: 1, at: '2026-10-08T09:00:00Z', origin_id: 'brazil', delta_kg: '-0.250', reason: 'order', ref: 'BC-2026-0007', note: '', actor: null }],
  notification_outbox: [
    { id: 1, created_at: '2026-10-08T09:00:00Z', channel: 'email', event: 'order.created', recipient: 'team@example.test', subject: 'Nouvelle commande BC-2026-0007',
      body: `${CUSTOMER.name} ${CUSTOMER.phone}`, status: 'pending', attempts: 0, last_error: null, sent_at: null },
  ],
  admin_config: [{ id: 1, admin_whatsapp: '212600000000', admin_email: 'team@example.test', whatsapp_on: true, email_on: true }],
};

interface Server {
  /** Auth's answer to every sign-in: by default the right password of ADMIN or OTHER signs in */
  signIn?: 'rate_limited';
  /** an admin table that refuses the read (an error, not empty rows) */
  failing?: string | null;
  /** a write function the database refuses, with its exception text */
  refuse?: { fn: string; message: string };
  /** account ids is_admin() accepts at aal2, with their admin_users role */
  admins?: Record<string, string>;
  /** ADMIN's authenticator apps: one set up by default */
  factors?: Factor[];
}

/** Answers Auth (password and TOTP), is_admin() and admin_users like Supabase; returns what the browser asked for. */
async function fakeSupabase(page: Page, server: Server = {}) {
  const admins = server.admins ?? { [ADMIN.id]: 'manager' };
  // this test's own copy: writes change it, and the next read shows them
  const db = structuredClone(ADMIN_TABLES) as Record<string, Record<string, unknown>[]>;
  // the catalog too: products and origins change through save_product and save_origin
  const catalog = structuredClone({ products: tables.products, origins: tables.origins }) as Record<'products' | 'origins', Record<string, unknown>[]>;
  /** the write functions called: name, arguments, and the level of the session that called */
  const writes: { fn: string; args: Record<string, unknown>; aal?: Aal }[] = [];
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
      // the database's rule (migration 20261008205033): an admin (of one of the roles asked), and the second factor passed
      const allowed = (req.postDataJSON() as { allowed?: string[] } | null)?.allowed;
      return json(200, !!(user && admins[user] && (!allowed || allowed.includes(admins[user])) && claims?.aal === 'aal2'));
    }
    const write = url.pathname.match(/^\/rest\/v1\/rpc\/(set_order_status|set_payment_status|adjust_stock|update_quote_request|save_product|save_origin)$/)?.[1];
    if (write) {
      const args = req.postDataJSON() as Record<string, unknown>;
      writes.push({ fn: write, args, aal: claims?.aal });
      // what PostgREST answers to a function that raised an exception
      if (server.refuse?.fn === write) return json(400, { code: 'P0001', message: server.refuse.message, details: null, hint: null });
      const now = new Date().toISOString();
      const order = db.orders.find((o) => o.id === args.p_order_id);
      if (write === 'set_order_status' && order) {
        order.status = args.p_status;
        (order.order_events as unknown[]).push({ at: now, label: `status.${args.p_status}` });
      }
      if (write === 'set_payment_status' && order) {
        order.payment_status = args.p_status;
        (order.order_events as unknown[]).push({ at: now, label: `payment.${args.p_status}` });
      }
      if (write === 'adjust_stock') db.stock_movements.unshift({ id: 99, at: now, origin_id: args.p_origin_id, delta_kg: args.p_delta_kg, reason: args.p_reason, ref: '', note: args.p_note, actor: user });
      if (write === 'update_quote_request') {
        // the database's version check: a save from an older copy is refused
        if (db.quote_requests[0].updated_at !== args.p_seen_at) return json(400, { code: 'P0001', message: 'stale', details: null, hint: null });
        Object.assign(db.quote_requests[0], { status: args.p_status, final_price: args.p_final_price, admin_notes: args.p_admin_notes, updated_at: now });
      }
      if (write === 'save_product' || write === 'save_origin') {
        // the database's rules (migration 20261009200000): created hidden (an origin at 0 kg), an edit from the version read, the id fixed
        const refused = (message: string) => json(400, { code: 'P0001', message, details: null, hint: null });
        const item = (write === 'save_product' ? args.p_product : args.p_origin) as Record<string, unknown>;
        const rows = catalog[write === 'save_product' ? 'products' : 'origins'];
        const row = rows.find((x) => x.id === item.id);
        if (args.p_seen_at === null && row) return refused('exists');
        if (args.p_seen_at !== null && !row) return refused('not_found');
        if (row && row.updated_at !== args.p_seen_at) return refused('stale');
        const recipe = (args.p_recipe as { originId: string; percent: number }[] | undefined)?.map((l) => ({ origin_id: l.originId, percent: l.percent }));
        if (write === 'save_product') {
          const fields = { kind: item.kind, name: item.name, tagline: item.tagline, description: item.description, roast_level: item.roastLevel, tasting_notes: item.tastingNotes,
            prices: item.prices, featured: item.featured, sort_order: item.sortOrder, product_recipes: recipe, updated_at: now };
          if (row) Object.assign(row, fields, { active: item.active });
          else rows.push({ id: item.id, slug: item.id, image_url: null, ...fields, active: false });
        } else if (row) Object.assign(row, { price_per_kg: item.pricePerKg, low_stock_kg: item.lowStockKg, custom_blend_enabled: item.customBlendEnabled, updated_at: now });
        else rows.push({ id: item.id, name: item.name, country_code: item.countryCode, species: item.species, region: item.region, roast_level: item.roastLevel,
          tasting_notes: item.tastingNotes, stock_kg: 0, low_stock_kg: item.lowStockKg, price_per_kg: item.pricePerKg, custom_blend_enabled: item.customBlendEnabled,
          restock_date: null, active: false, updated_at: now });
        return json(200, item.id);
      }
      return json(200, null);
    }
    const table = url.pathname.match(/^\/rest\/v1\/(\w+)$/)?.[1] ?? '';
    if (table in db) {
      asked.push(`read ${table}`);
      // a refusal PostgREST does not retry (supabase-js retries a GET that got 503 or no answer, with pauses)
      if (server.failing === table) return json(403, { code: '42501', message: `permission denied for table ${table}` });
      // row level security: an admin past the second factor reads every row, any other session none (and no error)
      const rows = user && admins[user] && claims?.aal === 'aal2' ? db[table] : [];
      const single = (req.headers()['accept'] ?? '').includes('vnd.pgrst.object');
      return json(200, single ? (rows[0] ?? null) : rows);
    }
    if (url.pathname === '/rest/v1/admin_users') {
      // row level security: an account reads its own row, at any level
      const own = user && url.searchParams.get('user_id') === `eq.${user}` && admins[user] ? { role: admins[user] } : null;
      const single = (req.headers()['accept'] ?? '').includes('vnd.pgrst.object');
      return json(200, single ? own : own ? [own] : []);
    }
    shopAs.push(user);
    if (table === 'products' || table === 'origins') {
      // row level security: a visitor reads the shown rows only
      const admin = user && admins[user] && claims?.aal === 'aal2';
      return json(200, catalog[table].filter((x) => admin || x.active));
    }
    return answerCatalog(r);
  });
  return Object.assign(asked, { shopAs, writes, db, catalog });
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
    // the panel's place, then its data (read as this session), confirmed by is_admin() again
    expect(asked.filter((a) => !a.startsWith('read '))).toEqual(['sign-in', 'code', 'code', 'is_admin', 'is_admin']);
    expect(asked).toContain('read orders');
    // manager: no payments nor settings
    const nav = page.getByRole('navigation', { name: 'Panel Admin' });
    await expect(nav.getByRole('link', { name: 'Commandes' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Paiements' })).toHaveCount(0);
    await expect(page.locator('.admin-live-bar .notice-warn')).toContainText('Les commandes, le stock, les demandes B2B, les produits et les origines se modifient ici');
    await expect(page.getByRole('link', { name: 'BC-2026-0007' })).toBeVisible();
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

  test('the panel shows the live data at aal2; what is not connected yet is off, with a "coming soon" note', async ({ page }) => {
    test.setTimeout(60_000); // 12 pages, each with an axe scan: near the 30 s default on a slow runner
    await page.addInitScript(([k, v]) => localStorage.getItem(k) ?? localStorage.setItem(k, v), [STORAGE_KEY, JSON.stringify(session(ADMIN, 'aal2'))]);
    const asked = await fakeSupabase(page, { admins: { [ADMIN.id]: 'owner' } });
    await open(page, '/admin/orders');
    const row = page.getByRole('row', { name: /BC-2026-0007/ });
    await expect(row).toContainText(CUSTOMER.name);
    await expect(row).toContainText(CUSTOMER.phone);
    expect(asked.filter((a) => a.startsWith('read '))).toEqual(
      expect.arrayContaining(['read orders', 'read quote_requests', 'read stock_movements', 'read notification_outbox', 'read admin_config']),
    );

    await open(page, `/admin/orders/${ORDER_ID}`);
    await expect(page.getByRole('heading', { level: 1, name: 'BC-2026-0007' })).toBeVisible();
    await expect(page.locator('.history li')).toHaveText([/signalé un paiement/, /Commande passée/]); // newest first

    // on every page: the "coming soon" note where something could be changed, and no control left on but
    // reading tools (refresh, tabs, search, the delivery simulator) and the writes of slices 8-9 (orders, stock, B2B, catalog)
    const SOON = 'Bientôt : les modifications ici ne sont pas encore branchées.';
    const pages: [path: string, wired: string, note: string | null][] = [
      ['', '', null],
      ['/orders', '', null],
      [`/orders/${ORDER_ID}`, 'button', null],
      ['/b2b', 'fieldset *', null],
      ['/products', 'a[href*="/new?"]', null],
      // the form, its save button; no delete button on the live site (a product is hidden, never deleted)
      ['/products/boga-signature', 'fieldset *, .admin-head .btn-primary', null],
      ['/stock', '.admin-head button, tbody button, tbody input[type=checkbox]', null],
      ['/shipping', '', SOON],
      ['/payments', 'tbody button', 'Bientôt : les moyens de paiement et les coordonnées du bénéficiaire ne sont pas encore branchés. « Marquer payé » fonctionne.'],
      ['/notifications', '', SOON],
      ['/content', '', SOON],
      ['/settings', '', SOON],
    ];
    for (const [path, wired, note] of pages) {
      const readingTools = ['.admin-live-bar button, [role=tab], input[type=search], .shipping-sim *', wired].filter(Boolean).join(', ');
      await open(page, `/admin${path}`);
      const on = await page.locator('.admin-main').evaluate(
        (main, tools) =>
          // and no link to a form that would create something
          [...main.querySelectorAll<HTMLInputElement>('input, select, textarea, button, a[href$="/new"], a[href*="/new?"]')]
            .filter((c) => !c.matches(':disabled') && !c.matches(tools))
            .map((c) => c.outerHTML.slice(0, 80)),
        readingTools,
      );
      expect(on, `${path || '/'}: ${on.join(' | ')}`).toEqual([]);
      if (note) await expect(page.locator('.coming-soon').first(), path).toHaveText(note);
      else await expect(page.locator('.coming-soon'), path).toHaveCount(0);
      await scanA11y(page, `admin${path}`);
      if (path === '/b2b') await expect(page.getByText('QR-2026-0003')).toBeVisible();
      if (path === '/notifications') await expect(page.locator('.log-item .pill')).toHaveText('pas encore envoyé'); // the queue, not "sent"
    }

    // customer details stay in the page: nothing kept in the browser's storage
    const stored = JSON.stringify(await page.evaluate(() => ({ ...localStorage, ...sessionStorage })));
    expect(stored).not.toContain(CUSTOMER.phone);
    expect(stored).not.toContain(CUSTOMER.name);
  });

  test('a failed read, or a session the database no longer counts as an admin, shows an error: never an empty list', async ({ page }) => {
    await page.addInitScript(([k, v]) => localStorage.getItem(k) ?? localStorage.setItem(k, v), [STORAGE_KEY, JSON.stringify(session(ADMIN, 'aal2'))]);
    const server: Server = { admins: { [ADMIN.id]: 'owner' }, failing: 'orders' };
    await fakeSupabase(page, server);
    await page.goto('/admin/orders');
    const failed = page.getByRole('alert');
    await expect(failed).toContainText('n’ont pas pu être chargées');
    await expect(page.getByText('Aucune commande')).toHaveCount(0);
    await scanA11y(page, 'admin data failed');

    server.failing = null;
    await page.getByRole('button', { name: 'Réessayer' }).click();
    await expect(page.getByRole('link', { name: 'BC-2026-0007' })).toBeVisible();

    // the account loses its admin rights while the panel is open: the next read shows no empty list, and the account is out
    delete server.admins![ADMIN.id];
    await page.getByRole('button', { name: 'Actualiser' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Accès refusé' })).toBeVisible();
    await expect(page.getByText('BC-2026-0007')).toHaveCount(0);
  });

  test('orders, payments, stock and B2B follow-up are saved through the database functions, then read again', async ({ page }) => {
    await page.addInitScript(([k, v]) => localStorage.getItem(k) ?? localStorage.setItem(k, v), [STORAGE_KEY, JSON.stringify(session(ADMIN, 'aal2'))]);
    const { writes } = await fakeSupabase(page, { admins: { [ADMIN.id]: 'owner' } });

    await open(page, `/admin/orders/${ORDER_ID}`);
    await page.getByRole('button', { name: 'Passer à : Confirmée' }).click();
    await expect(page.locator('.history li').first()).toContainText('Statut : confirmée'); // read again after the write
    await page.getByRole('button', { name: 'Marquer payé' }).click();
    await expect(page.locator('.history li').first()).toContainText('Paiement confirmé');
    await expect(page.locator('.write-error')).toHaveCount(0);

    await open(page, '/admin/stock');
    await page.getByRole('button', { name: 'Ajuster le stock' }).click();
    await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
    await page.getByLabel('Quantité (kg)').fill('2,5');
    await page.getByLabel('Note').fill('TEST lot');
    await page.getByRole('button', { name: 'Appliquer' }).click();
    await expect(page.getByRole('cell', { name: 'TEST lot' })).toBeVisible();

    await open(page, '/admin/b2b');
    await page.getByLabel('Notes internes').fill('TEST rappeler lundi');
    expect(writes.map((w) => w.fn)).not.toContain('update_quote_request'); // typing saves nothing
    await page.getByRole('button', { name: 'Enregistrer · QR-2026-0003' }).click();
    await expect(page.locator('.pill-ok', { hasText: 'Enregistré' })).toBeVisible();

    expect(writes).toEqual([
      { fn: 'set_order_status', args: { p_order_id: ORDER_ID, p_status: 'confirmed' }, aal: 'aal2' },
      { fn: 'set_payment_status', args: { p_order_id: ORDER_ID, p_status: 'paid' }, aal: 'aal2' },
      { fn: 'adjust_stock', args: { p_origin_id: 'brazil', p_delta_kg: 2.5, p_reason: 'restock', p_note: 'TEST lot' }, aal: 'aal2' },
      { fn: 'update_quote_request', args: { p_id: 'quote-1', p_status: 'new', p_final_price: null, p_admin_notes: 'TEST rappeler lundi', p_seen_at: '2026-10-08T08:00:00.000001+00:00' }, aal: 'aal2' },
    ]);
  });

  test('stock: "Remove 10" sends -10 (a phone keypad has no minus key); Apply waits for a choice and an amount above 0', async ({ page }) => {
    await page.addInitScript(([k, v]) => localStorage.getItem(k) ?? localStorage.setItem(k, v), [STORAGE_KEY, JSON.stringify(session(ADMIN, 'aal2'))]);
    const { writes } = await fakeSupabase(page, { admins: { [ADMIN.id]: 'owner' } });
    await open(page, '/admin/stock');
    await page.getByRole('button', { name: 'Ajuster le stock' }).click();
    const apply = page.getByRole('button', { name: 'Appliquer' });
    await expect(apply).toBeDisabled(); // no choice, no amount
    await page.getByLabel('Quantité (kg)').fill('10');
    await expect(apply).toBeDisabled(); // an amount, still no choice
    await page.getByRole('button', { name: 'Retirer' }).click();
    await expect(page.getByRole('button', { name: 'Retirer' })).toHaveAttribute('aria-pressed', 'true');
    await page.getByLabel('Quantité (kg)').fill('0');
    await expect(apply).toBeDisabled(); // 0 kg changes nothing
    await page.getByLabel('Quantité (kg)').fill('10');
    await expect(page.locator('.stock-result')).toHaveText(/Stock :.*80 kg.*→.*70 kg/); // shown before applying
    await page.getByLabel('Note').fill('TEST');
    await apply.click();
    await expect(page.getByRole('cell', { name: 'TEST', exact: true })).toBeVisible();
    // a withdrawal is recorded as a correction, never as a delivery
    expect(writes).toEqual([{ fn: 'adjust_stock', args: { p_origin_id: 'brazil', p_delta_kg: -10, p_reason: 'correction', p_note: 'TEST' }, aal: 'aal2' }]);
  });

  test('the B2B form follows what another admin saved; an older copy is never saved over it', async ({ page }) => {
    await page.addInitScript(([k, v]) => localStorage.getItem(k) ?? localStorage.setItem(k, v), [STORAGE_KEY, JSON.stringify(session(ADMIN, 'aal2'))]);
    const { db, writes } = await fakeSupabase(page, { admins: { [ADMIN.id]: 'owner' } });
    await open(page, '/admin/b2b');
    await page.getByLabel('Prix final (MAD)').fill('5800');
    // meanwhile another admin saves a note
    Object.assign(db.quote_requests[0], { admin_notes: 'TEST note de Mohammed', updated_at: '2026-10-08T09:00:00.000001+00:00' });
    await page.getByRole('button', { name: 'Enregistrer · QR-2026-0003' }).click();
    await expect(page.locator('.write-error')).toBeVisible(); // 'stale': nothing written over the note
    await expect(page.getByLabel('Notes internes')).toHaveValue('TEST note de Mohammed'); // read again, the form shows it
    expect(db.quote_requests[0].admin_notes).toBe('TEST note de Mohammed');
    expect(writes).toHaveLength(1);
  });

  test('a new origin and a new product are created hidden; an edit carries the version read, and the id never changes', async ({ page }) => {
    await page.addInitScript(([k, v]) => localStorage.getItem(k) ?? localStorage.setItem(k, v), [STORAGE_KEY, JSON.stringify(session(ADMIN, 'aal2'))]);
    const { writes, catalog } = await fakeSupabase(page);

    await open(page, '/admin/stock');
    await page.getByRole('button', { name: 'Nouvelle origine' }).click();
    await expect(page.getByRole('checkbox', { name: 'Visible sur le site' })).toBeDisabled(); // created hidden, at 0 kg
    await page.locator('#o-name-fr').fill('TEST origine');
    await page.getByLabel('Code pays (ISO)').fill('et');
    await page.getByLabel('Prix Custom Blend / kg').fill('100');
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    const row = page.getByRole('row', { name: /TEST origine/ });
    await expect(row).toBeVisible(); // read again after the write
    // afterwards: the price, the alert level and Custom Blend only
    await row.getByRole('button', { name: 'Modifier' }).click();
    await expect(page.locator('#o-name-fr')).toBeDisabled();
    await expect(page.getByLabel('Code pays (ISO)')).toBeDisabled();
    await page.getByLabel('Prix Custom Blend / kg').fill('120');
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(row).toContainText('120');
    await page.getByRole('checkbox', { name: 'Dans le Custom Blend · Brésil' }).click({ force: true }); // the input sits under the drawn switch
    await expect(page.getByRole('checkbox', { name: 'Dans le Custom Blend · Brésil' })).not.toBeChecked();

    await open(page, '/admin/products/new?kind=signature');
    await expect(page.getByRole('checkbox', { name: 'Visible sur le site' })).toBeDisabled();
    await expect(page.getByText('Un nouveau produit est créé masqué')).toBeVisible();
    await page.locator('#p-name-fr').fill('TEST produit');
    await page.locator('section', { hasText: 'Prix par sachet' }).locator('input').first().fill('1');
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page).toHaveURL(/\/admin\/products$/);
    await expect(page.getByRole('row', { name: /TEST produit/ })).toBeVisible();
    // no delete button on the live site: orders keep the productId they were bought with
    await open(page, '/admin/products/test-produit');
    await expect(page.getByRole('button', { name: 'Supprimer' })).toHaveCount(0);

    const [origin, edit, blend, product] = writes;
    expect(origin).toEqual({ fn: 'save_origin', aal: 'aal2', args: { p_seen_at: null, p_origin: expect.objectContaining({ id: 'test-origine', countryCode: 'ET', pricePerKg: 100 }) } });
    // the version the editor read: the one the creation gave it
    expect(edit.args).toEqual({ p_seen_at: expect.any(String), p_origin: expect.objectContaining({ id: 'test-origine', pricePerKg: 120 }) });
    expect(blend.args).toEqual({ p_seen_at: '2026-10-09T08:00:00.000001+00:00', p_origin: expect.objectContaining({ id: 'brazil', customBlendEnabled: false }) });
    expect(product).toEqual({
      fn: 'save_product',
      aal: 'aal2',
      args: { p_seen_at: null, p_recipe: [{ originId: 'brazil', percent: 100 }], p_product: expect.objectContaining({ id: 'test-produit', slug: 'test-produit', active: false, prices: { '250': 1 } }) },
    });
    expect(catalog.products.find((x) => x.id === 'test-produit')).toMatchObject({ active: false });
    expect(catalog.origins.find((x) => x.id === 'test-origine')).toMatchObject({ active: false, stock_kg: 0, price_per_kg: 120 });
  });

  test('a product saved from an older copy is refused: "not confirmed", the form shows what is saved, never left as if saved', async ({ page }) => {
    await page.addInitScript(([k, v]) => localStorage.getItem(k) ?? localStorage.setItem(k, v), [STORAGE_KEY, JSON.stringify(session(ADMIN, 'aal2'))]);
    const { writes, catalog } = await fakeSupabase(page);
    await open(page, '/admin/products/boga-signature');
    const price250 = page.locator('section', { hasText: 'Prix par sachet' }).locator('input').first();
    await price250.fill('70');
    // meanwhile another admin changes the price
    Object.assign(catalog.products[0], { prices: { 250: 68, 500: 120, 1000: 220 }, updated_at: '2026-10-09T09:00:00.000001+00:00' });
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.locator('.write-error')).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/products\/boga-signature$/); // still on the form
    await expect(price250).toHaveValue('68'); // read again: the other admin's price, not overwritten
    expect(writes.map((w) => w.args.p_seen_at)).toEqual(['2026-10-09T08:00:00.000002+00:00']);
    expect(catalog.products[0].prices).toEqual({ 250: 68, 500: 120, 1000: 220 });
  });

  test('a refused write says so and never shows "saved"; staff never gets the owner\'s payment buttons', async ({ page }) => {
    await page.addInitScript(([k, v]) => localStorage.getItem(k) ?? localStorage.setItem(k, v), [STORAGE_KEY, JSON.stringify(session(ADMIN, 'aal2'))]);
    const server: Server = { admins: { [ADMIN.id]: 'owner' }, refuse: { fn: 'update_quote_request', message: 'invalid_status' } };
    await fakeSupabase(page, server);
    await open(page, '/admin/b2b');
    await page.getByRole('button', { name: 'Enregistrer · QR-2026-0003' }).click();
    await expect(page.getByRole('alert')).toHaveText('La modification n’a pas été confirmée : refusée, ou pas de réponse du serveur. La page montre maintenant ce qui est enregistré : vérifiez avant de réessayer.');
    await expect(page.locator('.pill-ok', { hasText: 'Enregistré' })).toHaveCount(0);
    await scanA11y(page, 'write refused');

    server.refuse = { fn: 'set_order_status', message: 'needs_payment' };
    await open(page, `/admin/orders/${ORDER_ID}`);
    await page.getByRole('button', { name: 'Passer à : Confirmée' }).click();
    await expect(page.locator('.write-error')).toBeVisible();
    await expect(page.locator('.history li')).toHaveCount(2); // nothing recorded
    server.refuse = { fn: 'set_payment_status', message: 'forbidden' };
    await page.getByRole('button', { name: 'Marquer payé' }).click();
    await expect(page.locator('.write-error')).toBeVisible();
    await expect(page.locator('.history li')).toHaveCount(2);

    const staff = await page.context().newPage();
    await staff.addInitScript(([k, v]) => localStorage.getItem(k) ?? localStorage.setItem(k, v), [STORAGE_KEY, JSON.stringify(session(ADMIN, 'aal2'))]);
    await fakeSupabase(staff, { admins: { [ADMIN.id]: 'staff' } });
    await open(staff, `/admin/orders/${ORDER_ID}`);
    await expect(staff.getByText('Seul le propriétaire enregistre les paiements.')).toBeVisible();
    await expect(staff.getByRole('button', { name: 'Marquer payé' })).toHaveCount(0);
    await expect(staff.getByRole('navigation', { name: 'Panel Admin' }).getByRole('link', { name: 'Paiements' })).toHaveCount(0);
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
