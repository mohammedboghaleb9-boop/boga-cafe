import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { open, signIn } from './helpers';

// WCAG 2.2 level A and AA rules
const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const store = ['/', '/shop', '/single-origin', '/custom-blend', '/b2b', '/cart', '/checkout', '/contact', '/product/boga-signature', '/order/unknown'];
const admin = ['/admin', '/admin/orders', '/admin/b2b', '/admin/products', '/admin/products/new', '/admin/stock', '/admin/shipping', '/admin/payments', '/admin/notifications', '/admin/content', '/admin/settings'];

const scan = async (page: import('@playwright/test').Page, where: string) => {
  const r = await new AxeBuilder({ page }).withTags(tags).analyze();
  const found = r.violations.map((v) => `${where}: ${v.id} (${v.impact}) × ${v.nodes.length} — ${v.nodes[0]?.target.join(' ')}`);
  expect(found, found.join('\n')).toEqual([]);
};

for (const locale of ['fr-FR', 'ar-MA']) {
  test.describe(`accessibility ${locale}`, () => {
    test.use({ locale });

    test('store pages', async ({ page }) => {
      for (const path of store) {
        await open(page, path);
        await scan(page, path);
      }
    });

    test('admin pages', async ({ page }) => {
      test.slow(); // 12 pages scanned one after the other
      await open(page, '/admin');
      await scan(page, '/admin (sign in)');
      await signIn(page, 'owner');
      for (const path of admin) {
        await open(page, path);
        await scan(page, path);
      }
      await open(page, '/admin/orders');
      await page.locator('tbody .row-link').first().click();
      await expect(page.locator('h1.num')).toBeVisible();
      await scan(page, 'order detail');
    });
  });
}
