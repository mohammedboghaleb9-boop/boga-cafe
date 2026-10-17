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
