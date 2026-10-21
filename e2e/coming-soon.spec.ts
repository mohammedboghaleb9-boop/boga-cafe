import { expect, test } from '@playwright/test';
import { clippedContent, expectNoSideScroll, open, scanA11y, watchErrors } from './helpers';

/**
 * The "coming soon" page, production's fallback (scripts/build-target.mjs; dist-coming-soon, served like Cloudflare: any unknown
 * path answered with index.html). Every old shop or admin link shows the "coming soon" page: no
 * product, price, cart or form, and no request to the database or any other site.
 */
const oldLinks = [
  '/', '/shop', '/single-origin', '/custom-blend', '/b2b', '/cart', '/checkout', '/contact',
  '/product/boga-signature', '/product/single-origin-ethiopia', '/order/BC-2026-0001', '/admin', '/admin/orders',
];
const titles = { ar: 'قريباً', fr: 'Bientôt en ligne', en: 'Coming soon' };

test('every old link shows "coming soon" and nothing of the shop', async ({ page, baseURL }) => {
  const errors = watchErrors(page);
  const elsewhere: string[] = [];
  const failed: string[] = [];
  page.on('request', (r) => {
    if (!r.url().startsWith(baseURL!)) elsewhere.push(r.url());
  });
  page.on('response', (r) => {
    if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);
  });
  for (const path of oldLinks) {
    await open(page, path);
    await expect(page.locator('h1'), path).toHaveText(titles.fr);
    await expect(page.locator('html'), path).toHaveAttribute('data-site', 'coming-soon');
    if (path === '/') await expect(page.locator('meta[name="robots"]'), path).toHaveCount(0);
    else await expect(page.locator('meta[name="robots"]'), path).toHaveAttribute('content', 'noindex');
    expect(await page.locator('form, input, select, textarea').count(), path).toBe(0);
    // prices are written "65 DH" / "65 MAD" in the shop
    await expect(page.locator('body'), path).not.toContainText(/\d\s*(DH|MAD|د\.?م)/i);
    // the only links: the real contact channels (never a page of the shop)
    const hrefs = await page.locator('a').evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''));
    expect(hrefs.filter((h) => !/^(https:\/\/|mailto:)/.test(h)), path).toEqual([]);
  }
  expect(elsewhere).toEqual([]);
  expect(failed).toEqual([]);
  errors.check();
});

test('the real contact channels', async ({ page }) => {
  await open(page, '/');
  const hrefs = await page.locator('main a').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  expect(hrefs).toEqual([
    'https://wa.me/212609036378',
    'mailto:bogacafe1@gmail.com',
    'https://www.instagram.com/boga.cafe1',
    'https://www.tiktok.com/@bogacafe795',
    'https://www.facebook.com/profile.php?id=61594620729419',
  ]);
  await expect(page.locator('main')).toContainText('Oujda, Maroc');
});

test('three languages, Arabic right to left, the choice kept', async ({ page }) => {
  await open(page, '/shop');
  await page.getByRole('button', { name: 'العربية' }).click();
  await expect(page.locator('h1')).toHaveText(titles.ar);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(page.getByRole('button', { name: 'العربية' })).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(page.locator('h1')).toHaveText(titles.ar);
  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.locator('h1')).toHaveText(titles.en);
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(page).toHaveTitle('BOGA CAFÉ — Coming soon');
});

// pictures of the tested build for the owner's review (CI uploads them with the files: .github/workflows/ci.yml)
for (const [locale, width, path] of [['ar-MA', 390, '/shop'], ['fr-FR', 1280, '/product/boga-signature'], ['en-US', 320, '/checkout']] as const) {
  test.describe(`picture ${locale} ${width}px`, () => {
    test.use({ locale, viewport: { width, height: 800 } });

    test(`${path}`, async ({ page }) => {
      await open(page, path);
      await expect(page.locator('h1')).toHaveText(titles[locale.slice(0, 2) as keyof typeof titles]);
      await page.screenshot({ path: `coming-soon-review/${locale.slice(0, 2)}-${width}${path.replace(/\//g, '_')}.png`, fullPage: true });
    });
  });
}

for (const locale of ['fr-FR', 'ar-MA', 'en-US']) {
  test.describe(locale, () => {
    test.use({ locale });

    test('accessibility', async ({ page }) => {
      await open(page, '/');
      await scanA11y(page, `/ ${locale}`);
    });

    for (const width of [320, 390]) {
      test(`${width}px: no sideways scroll, nothing cut off`, async ({ page }) => {
        await page.setViewportSize({ width, height: 800 });
        await open(page, '/');
        await expectNoSideScroll(page);
        expect(await clippedContent(page)).toEqual([]);
      });
    }
  });
}
