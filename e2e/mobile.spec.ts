import { expect, test } from '@playwright/test';
import { addSignatureBag, clippedContent, expectNoSideScroll, fillCheckout, open, signIn } from './helpers';

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
          // inside a table (which scrolls) buttons and status labels stay on one line
          const tall = await page.evaluate(() =>
            [...document.querySelectorAll('.table .btn, .table .pill')]
              .filter((e) => {
                const cs = getComputedStyle(e);
                const inner = e.getBoundingClientRect().height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - parseFloat(cs.borderTopWidth) - parseFloat(cs.borderBottomWidth);
                return inner / parseFloat(cs.lineHeight) > 1.5; // more than one line of text
              })
              .map((e) => e.textContent?.trim()),
          );
          expect(tall, path).toEqual([]);
        }
        await open(page, '/admin/orders');
        await page.locator('tbody .row-link').first().click();
        await expect(page.locator('h1.num')).toBeVisible();
        await expectNoSideScroll(page);
      });

      test('a placed order: the customer\'s page (bank details, WhatsApp button)', async ({ page }) => {
        await addSignatureBag(page);
        await fillCheckout(page, 'bank_transfer');
        await expect(page.locator('.handoff-wa')).toBeVisible();
        await expectNoSideScroll(page);
        expect(await clippedContent(page)).toEqual([]);
      });
    });
  }
}

// narrower than the target phones: fonts differ a little between machines, so a
// long unbroken text (the 24-digit RIB) that just fits at 320 px locally is caught here
test.describe('300px fr-FR', () => {
  test.use({ viewport: { width: 300, height: 800 }, locale: 'fr-FR' });
  test('a placed order: nothing cut off', async ({ page }) => {
    await addSignatureBag(page);
    await fillCheckout(page, 'bank_transfer');
    await expect(page.locator('.handoff-wa')).toBeVisible();
    expect(await clippedContent(page)).toEqual([]);
  });
});

test.describe('desktop', () => {
  test.use({ viewport: { width: 1280, height: 900 } });
  test('product cards: status labels are not cut', async ({ page }) => {
    for (const path of ['/shop', '/single-origin']) {
      await open(page, path);
      expect(await clippedContent(page), path).toEqual([]);
    }
  });
});
