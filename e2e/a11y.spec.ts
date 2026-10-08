import { expect, test } from '@playwright/test';
import { open, scanA11y as scan, signIn } from './helpers';

const store = ['/', '/shop', '/single-origin', '/custom-blend', '/b2b', '/cart', '/checkout', '/contact', '/product/boga-signature', '/order/unknown'];
const admin = ['/admin', '/admin/orders', '/admin/b2b', '/admin/products', '/admin/products/new', '/admin/stock', '/admin/shipping', '/admin/payments', '/admin/notifications', '/admin/content', '/admin/settings'];


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

// audit M3: found by hand, now guarded
test.describe('keyboard and page titles', () => {
  test('each page has its own title, in the visitor language', async ({ page }) => {
    const titles = new Map<string, string>();
    for (const path of ['/', '/shop', '/custom-blend', '/cart', '/contact', '/product/boga-signature', '/order/unknown']) {
      await open(page, path);
      titles.set(path, await page.title());
    }
    expect(titles.get('/')).toBe('BOGA CAFÉ');
    expect(titles.get('/shop')).toBe('Boutique — BOGA CAFÉ');
    expect(titles.get('/product/boga-signature')).toMatch(/^[^—]+ — BOGA CAFÉ$/);
    expect(new Set(titles.values()).size).toBe(titles.size); // no two pages share a title
  });

  test('the first Tab offers to skip the header, and it lands in the page content', async ({ page }) => {
    await open(page, '/shop');
    await page.keyboard.press('Tab');
    const skip = page.locator('.skip-link');
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    await page.keyboard.press('Enter');
    await expect(page.locator('main#main')).toBeFocused();
    await expect(page).toHaveURL(/\/shop$/); // the route did not change
    await page.keyboard.press('Tab'); // next stop is inside the content, not the header
    expect(await page.evaluate(() => !!document.activeElement?.closest('main'))).toBe(true);
  });

  test.describe('phone', () => {
    test.use({ viewport: { width: 390, height: 800 } });
    test('Escape closes the menu and gives the focus back to its button', async ({ page }) => {
      await open(page, '/shop');
      const button = page.locator('.menu-btn');
      await button.click();
      await expect(page.locator('#mobile-nav')).toBeVisible();
      await expect(button).toHaveAttribute('aria-expanded', 'true');
      await page.keyboard.press('Escape');
      await expect(page.locator('#mobile-nav')).toBeHidden();
      await expect(button).toHaveAttribute('aria-expanded', 'false');
      await expect(button).toBeFocused();
    });
  });
});
