import { expect, test, type Page } from '@playwright/test';
import { expectNoSideScroll, open, scanA11y } from './helpers';
import { answerCatalog, CORS, SUPABASE, tables } from './live';

/**
 * The live-site build while the owner has not opened the sales (slice 12: settings.salesOpen missing,
 * as on the live database today): the cart, the checkout and the B2B form say so, and a checkout form
 * submitted anyway sends nothing to the storefront function. The server and the database refuse it too (src/server and supabase/tests).
 */
async function closedSite(page: Page, cart: object[]) {
  const sent: string[] = [];
  await page.addInitScript((c) => localStorage.setItem('boga-cart', JSON.stringify(c)), cart);
  await page.route('https://challenges.cloudflare.com/**', (r) => r.abort('blockedbyclient'));
  await page.route(`${SUPABASE}/**`, (r) => {
    const req = r.request();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    const path = new URL(req.url()).pathname;
    if (path.includes('/functions/v1/storefront/')) {
      sent.push(path);
      return r.fulfill({ headers: CORS, json: { ok: false, errors: ['sales_closed'] } });
    }
    if (path.endsWith('/site_config')) {
      const [row] = tables.site_config as { settings: Record<string, unknown> }[];
      const { salesOpen: _, ...settings } = row.settings; // no salesOpen at all: closed
      const closed = { ...row, settings };
      const single = (req.headers()['accept'] ?? '').includes('vnd.pgrst.object');
      return r.fulfill({ headers: CORS, contentType: 'application/json', json: single ? closed : [closed] });
    }
    return answerCatalog(r);
  });
  return sent;
}

const bag = [{ id: 'l1', type: 'product', productId: 'boga-signature', size: 250, qty: 1 }];
const b2bCart = [{ id: 'l1', type: 'product', productId: 'boga-signature', size: 1000, qty: 11 }];

test.describe('sales closed on the live site', () => {
  test('cart and checkout say the orders are not open, offer no way to send one, and send nothing', async ({ page }) => {
    const sent = await closedSite(page, bag);
    await open(page, '/cart');
    await expect(page.getByRole('status').filter({ hasText: 'pas encore ouvertes' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Valider la commande' })).toHaveCount(0);
    await open(page, '/checkout');
    await expect(page.getByRole('status').filter({ hasText: 'pas encore ouvertes' })).toBeVisible();
    await expect(page.locator('form.checkout button[type=submit]')).toBeDisabled();
    await scanA11y(page, 'checkout, sales closed');
    // the form submitted anyway (Enter in a field, a script): it says so and sends nothing
    await page.locator('form.checkout').evaluate((f) => (f as HTMLFormElement).requestSubmit());
    await expect(page.locator('.checkout-errors')).toContainText('pas encore ouvertes');
    expect(sent).toEqual([]);
  });

  for (const locale of ['ar-MA', 'en-US']) {
    test.describe(`390px ${locale}`, () => {
      test.use({ locale, viewport: { width: 390, height: 844 } });
      test('the B2B form is replaced by the notice, inside the window', async ({ page }) => {
        await closedSite(page, b2bCart);
        await open(page, '/cart');
        await expect(page.locator('.b2b-box [role=status]')).toBeVisible();
        await expect(page.locator('.b2b-box form')).toHaveCount(0);
        await expectNoSideScroll(page);
        await expect(page.locator('aside [role=status]')).toHaveCount(0); // said once, in the B2B box
        await page.locator('.b2b-box').screenshot({ path: `test-results/sales-closed-b2b-${locale}.png` });
      });
    });
  }
});

/**
 * The live site as production shows it from 2026-10-21 (owner): the real start, every product, origin and city hidden,
 * the sales closed. Each page says the orders are not open, the lists say they are empty, and the Custom Blend shows
 * no builder (so no bag fee priced on its own); the pages ask not to be indexed.
 */
async function emptySite(page: Page) {
  await page.route('https://challenges.cloudflare.com/**', (r) => r.abort('blockedbyclient'));
  await page.route(`${SUPABASE}/**`, (r) => {
    const req = r.request();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    const table = new URL(req.url()).pathname.split('/').at(-1) ?? '';
    const single = (req.headers()['accept'] ?? '').includes('vnd.pgrst.object');
    if (table === 'site_config') {
      const [row] = tables.site_config as { settings: Record<string, unknown> }[];
      const { salesOpen: _, ...settings } = row.settings;
      // the home page's title is the owner's text (live has one; the e2e catalog has none)
      // the Custom Blend on with its bag fee, as live has it: the page must still show no builder and no fee
      const customBlend = { enabled: true, minPercent: 5, maxOrigins: 4, feeBySize: { 250: 10, 500: 15, 1000: 20 } };
      const closed = { ...row, settings: { ...settings, customBlend }, content: { heroTitle: { ar: 'بوكا كافي', fr: 'BOGA CAFÉ', en: 'BOGA CAFÉ' } } };
      return r.fulfill({ headers: CORS, contentType: 'application/json', json: single ? closed : [closed] });
    }
    // hidden rows are not returned to visitors (row security): an empty catalog
    if (['products', 'origins', 'shipping_rates'].includes(table)) return r.fulfill({ headers: CORS, contentType: 'application/json', json: [] });
    return answerCatalog(r);
  });
}

test.describe('the live site before the launch: empty catalog, sales closed', () => {
  test('every page says the orders are not open; lists are empty; no builder; not indexed', async ({ page }) => {
    await emptySite(page);
    for (const path of ['/', '/shop', '/single-origin', '/custom-blend', '/b2b', '/contact']) {
      await open(page, path);
      await expect(page.locator('.sales-notice'), path).toHaveText('Le site est en préparation : les commandes ne sont pas encore ouvertes.');
      await expect(page.locator('meta[name="robots"]'), path).toHaveAttribute('content', 'noindex');
      await expectNoSideScroll(page);
    }
    await open(page, '/shop');
    await expect(page.getByText('Aucun café dans cette catégorie pour le moment.')).toBeVisible();
    await open(page, '/b2b');
    await expect(page.getByText('Aucun café dans cette catégorie pour le moment.')).toBeVisible();
    await open(page, '/single-origin');
    await expect(page.getByText('Aucune origine disponible pour le moment.')).toBeVisible();
    await open(page, '/');
    await expect(page.getByText('Aucune origine disponible pour le moment.')).toBeVisible();
    await open(page, '/custom-blend');
    await expect(page.locator('.notice-warn')).toHaveText('Aucune origine disponible pour le moment.');
    await expect(page.getByRole('button', { name: /Ajouter au panier/ })).toHaveCount(0);
    await expect(page.getByText(/\d+\s*DH/)).toHaveCount(0);
    await scanA11y(page, 'custom blend, empty catalog');
  });

  test.describe('390px ar-MA', () => {
    test.use({ locale: 'ar-MA', viewport: { width: 390, height: 844 } });
    test('the notice reads in Arabic, inside the window', async ({ page }) => {
      await emptySite(page);
      await open(page, '/');
      await expect(page.locator('.sales-notice')).toHaveText('الموقع قيد التجهيز: الطلبات غير مفتوحة بعد.');
      await expectNoSideScroll(page);
      await page.screenshot({ path: 'test-results/live-empty-home-ar-390.png' });
    });
  });
});
