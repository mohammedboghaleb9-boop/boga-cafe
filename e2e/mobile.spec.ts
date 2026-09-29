import { expect, test } from '@playwright/test';
import { clippedContent, expectNoSideScroll, open, signIn } from './helpers';

const store = ['/', '/shop', '/single-origin', '/custom-blend', '/b2b', '/cart', '/checkout', '/contact', '/product/single-origin-ethiopia', '/order/unknown'];
const admin = ['/admin', '/admin/orders', '/admin/b2b', '/admin/products', '/admin/stock', '/admin/shipping', '/admin/payments', '/admin/notifications', '/admin/content', '/admin/settings'];

for (const width of [320, 390]) {
  for (const locale of ['fr-FR', 'ar-MA']) {
    test.describe(`${width}px ${locale}`, () => {
      test.use({ viewport: { width, height: 800 }, locale });

      test('store: no sideways scroll and nothing cut off', async ({ page }) => {
        for (const path of store) {
          await open(page, path);
          await expectNoSideScroll(page);
          expect(await clippedContent(page), path).toEqual([]);
        }
      });

      test('admin: no sideways scroll, order detail included', async ({ page }) => {
        await signIn(page, 'owner');
        for (const path of admin) {
          await open(page, path);
          await expectNoSideScroll(page);
        }
        await open(page, '/admin/orders');
        await page.locator('tbody .row-link').first().click();
        await expect(page).toHaveURL(/\/admin\/orders\/.+/);
        await expectNoSideScroll(page);
      });
    });
  }
}
