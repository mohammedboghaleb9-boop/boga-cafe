import { expect, test, type Page, type Request } from '@playwright/test';
import { clippedContent, expectNoSideScroll, open } from './helpers';

/**
 * Turnstile on the live-site build (VITE_DATA_MODE=supabase, .env.e2e-supabase), served on
 * port 4174 (playwright.config.ts). The test answers its Supabase (catalog rows, the storefront
 * function) and Cloudflare's widget script: a stand-in with the documented widget sizes that hands
 * out the dummy token of Cloudflare's "always passes" test key. The real widget is not loaded
 * here; the server's check of the token is unit tested (src/server/__tests__/storefront.test.ts).
 */
const SITE_KEY = '1x00000000000000000000AA';
const DUMMY_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';
const SUPABASE = 'https://e2e.supabase.test';

const L = (s: string) => ({ ar: s, fr: s, en: s });
const tables: Record<string, unknown[]> = {
  origins: [
    { id: 'brazil', name: L('Brésil'), country_code: 'BR', species: 'arabica', region: '', roast_level: 'medium', tasting_notes: L(''),
      stock_kg: 80, low_stock_kg: 5, price_per_kg: 200, custom_blend_enabled: true, restock_date: null, active: true, updated_at: '' },
  ],
  products: [
    { id: 'boga-signature', slug: 'boga-signature', kind: 'signature', name: L('BOGA Signature'), tagline: L(''), description: L(''), roast_level: 'medium',
      tasting_notes: L(''), prices: { 250: 65, 500: 120, 1000: 220 }, image_url: null, featured: true, active: true, sort_order: 1, updated_at: '',
      product_recipes: [{ origin_id: 'brazil', percent: 100 }] },
  ],
  shipping_rates: [{ id: 'oujda', city: L('Oujda'), distance_km: 0, base_fee: 20, included_kg: 3, extra_per_kg: 5, delivery_days: '1', active: true }],
  payment_methods: [{ id: 'cashplus', enabled: true, label: L('Cash Plus'), instructions: L('') }],
  // a payee, so Cash Plus can be chosen and the form reaches the server
  site_config: [{ settings: { cashplus: { beneficiary: 'BOGA E2E' } }, content: {} }],
};

/** Cloudflare's script, replaced: render() draws a box of the documented size and solves it unless held. */
const TURNSTILE_STUB = `
window.__ts = { renders: [], resets: 0, widgets: {} };
window.turnstile = {
  render(el, o) {
    const id = 'w' + window.__ts.renders.length;
    const box = document.createElement('div');
    box.className = 'ts-stub';
    box.style.cssText = o.size === 'compact' ? 'width:150px;height:140px' : o.size === 'flexible' ? 'width:100%;min-width:300px;height:65px' : 'width:300px;height:65px';
    el.appendChild(box);
    const solve = () => { if (!window.__tsHold) setTimeout(() => o.callback(${JSON.stringify(DUMMY_TOKEN)}), 20); };
    window.__ts.widgets[id] = { box, solve };
    window.__ts.renders.push({ sitekey: o.sitekey, language: o.language, size: o.size, theme: o.theme });
    solve();
    return id;
  },
  reset(id) { window.__ts.resets++; window.__ts.widgets[id]?.solve(); },
  remove(id) { window.__ts.widgets[id]?.box.remove(); delete window.__ts.widgets[id]; },
};`;

type Answer = Record<string, unknown>;
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS' };

/** Answers the catalog and the storefront function; returns the bodies the forms sent, by route. */
async function fakeServer(page: Page, opts: { answer?: Answer; turnstile?: 'stub' | 'blocked'; cart: object[] }) {
  const sent: { route: string; body: Answer }[] = [];
  await page.addInitScript((cart) => localStorage.setItem('boga-cart', JSON.stringify(cart)), opts.cart);
  await page.route('https://challenges.cloudflare.com/**', (r) =>
    opts.turnstile === 'blocked' ? r.abort('blockedbyclient') : r.fulfill({ contentType: 'text/javascript', body: TURNSTILE_STUB }),
  );
  await page.route(`${SUPABASE}/**`, async (r) => {
    const req: Request = r.request();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    const url = new URL(req.url());
    const fn = url.pathname.match(/\/functions\/v1\/storefront\/(\w+)$/);
    if (fn) {
      sent.push({ route: fn[1], body: req.postDataJSON() as Answer });
      return r.fulfill({ headers: CORS, contentType: 'application/json', json: opts.answer ?? { ok: false, errors: ['too_many'] } });
    }
    const rows = tables[url.pathname.split('/').at(-1) ?? ''];
    if (!rows) return r.fulfill({ status: 404, headers: CORS, json: { message: 'not in the e2e catalog' } });
    const single = (req.headers()['accept'] ?? '').includes('vnd.pgrst.object');
    return r.fulfill({ headers: CORS, contentType: 'application/json', json: single ? rows[0] : rows });
  });
  return sent;
}

const bag = [{ id: 'l1', type: 'product', productId: 'boga-signature', size: 250, qty: 1 }];
/** 11 kg: above the 10 kg threshold, so the cart page shows the B2B form. */
const b2bCart = [{ id: 'l1', type: 'product', productId: 'boga-signature', size: 1000, qty: 11 }];

async function fillCheckout(page: Page) {
  await open(page, '/checkout');
  await page.fill('#co-name', 'Client Test');
  await page.fill('#co-phone', '0612345678');
  await page.selectOption('#co-city', 'oujda');
  await page.fill('#co-address', '12 rue Test');
  await page.locator('input[value=cashplus]').check();
}
const placeOrder = (page: Page) => page.locator('form.checkout button[type=submit]').click();
const renders = (page: Page) => page.evaluate(() => (window as unknown as { __ts: { renders: object[] } }).__ts.renders);
const resets = (page: Page) => page.evaluate(() => (window as unknown as { __ts: { resets: number } }).__ts.resets);

/** The widget sits inside the window: nothing of it past either edge. */
async function expectWidgetInside(page: Page) {
  const box = await page.locator('.ts-stub').boundingBox();
  const vw = await page.evaluate(() => document.documentElement.clientWidth);
  expect(box, 'the widget is drawn').not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(-0.5);
  expect(box!.x + box!.width).toBeLessThanOrEqual(vw + 0.5);
}

test.describe('Turnstile on the live site', () => {
  test('checkout: the widget gets the test key in French, its token goes with the order, a new one after each answer', async ({ page }) => {
    const sent = await fakeServer(page, { cart: bag });
    await fillCheckout(page);
    await expect.poll(() => renders(page)).toEqual([{ sitekey: SITE_KEY, language: 'fr', size: 'flexible', theme: 'auto' }]);
    await placeOrder(page);
    await expect(page.locator('.checkout-errors')).toContainText('Trop de demandes');
    expect(sent.map((s) => [s.route, s.body.captchaToken])).toEqual([['order', DUMMY_TOKEN]]);
    // a token works once: the widget is reset and the resend carries the new one, with the same order key
    expect(await resets(page)).toBe(1);
    await placeOrder(page);
    await expect.poll(() => sent.length).toBe(2);
    expect(sent[1].body.captchaToken).toBe(DUMMY_TOKEN);
    expect(sent[1].body.idempotencyKey).toBe(sent[0].body.idempotencyKey);
  });

  test('nothing is sent while the check is not finished; the form says so', async ({ page }) => {
    await page.addInitScript(() => ((window as unknown as { __tsHold: boolean }).__tsHold = true));
    const sent = await fakeServer(page, { cart: bag });
    await fillCheckout(page);
    await expect(page.locator('.ts-stub')).toBeVisible();
    await placeOrder(page);
    await expect(page.locator('.checkout-errors')).toContainText('La vérification anti-robot n’a pas abouti');
    expect(sent).toEqual([]);
    // solved: the order goes
    await page.evaluate(() => {
      const w = window as unknown as { __tsHold: boolean; __ts: { widgets: Record<string, { solve(): void }> } };
      w.__tsHold = false;
      Object.values(w.__ts.widgets).forEach((x) => x.solve());
    });
    await placeOrder(page);
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0].body.captchaToken).toBe(DUMMY_TOKEN);
  });

  test('a blocked widget is explained, and the order is not sent without it', async ({ page }) => {
    page.on('console', () => {}); // the blocked script is logged on purpose
    const sent = await fakeServer(page, { cart: bag, turnstile: 'blocked' });
    await fillCheckout(page);
    await expect(page.locator('.captcha [role=alert]')).toContainText('n’a pas pu se charger');
    await placeOrder(page);
    await expect(page.locator('.checkout-errors')).toContainText('La vérification anti-robot n’a pas abouti');
    expect(sent).toEqual([]);
  });

  for (const width of [320, 390]) {
    for (const [locale, lang, tooMany] of [
      ['ar-MA', 'ar', 'طلبات كثيرة'],
      ['en-US', 'en', 'Too many requests'],
    ] as const) {
      test.describe(`${width}px ${locale}`, () => {
        test.use({ viewport: { width, height: 800 }, locale });

        test('checkout and the B2B request: widget in the visitor language, inside the window, token sent', async ({ page }) => {
          const sent = await fakeServer(page, { cart: bag });
          await fillCheckout(page);
          await expect(page.locator('.ts-stub')).toBeVisible();
          const [checkoutWidget] = await renders(page);
          expect(checkoutWidget).toMatchObject({ sitekey: SITE_KEY, language: lang });
          await expectWidgetInside(page);
          await expectNoSideScroll(page);
          expect(await clippedContent(page)).toEqual([]);

          await page.evaluate((cart) => localStorage.setItem('boga-cart', JSON.stringify(cart)), b2bCart);
          await page.addInitScript((cart) => localStorage.setItem('boga-cart', JSON.stringify(cart)), b2bCart);
          await open(page, '/cart');
          await page.selectOption('#quote-type', { index: 1 });
          await page.fill('#quote-name', 'Amine Test');
          await page.fill('#quote-phone', '0612345678');
          await page.selectOption('#quote-city', 'oujda');
          await expect(page.locator('.b2b-box .ts-stub')).toBeVisible();
          await expectWidgetInside(page);
          await expectNoSideScroll(page);
          expect(await clippedContent(page)).toEqual([]);
          await page.locator('.b2b-box button[type=submit]').click();
          await expect(page.locator('.b2b-box [role=alert]')).toContainText(tooMany);
          expect(sent.map((s) => [s.route, s.body.captchaToken])).toEqual([['quote', DUMMY_TOKEN]]);
        });
      });
    }
  }
});
