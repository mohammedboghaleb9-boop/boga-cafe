import { expect, test, type Page } from '@playwright/test';
import { open } from './helpers';

/** Where the badge is in the backdrop (blend-backdrop.webp, 1672 × 941): x 997–1540, y 174–753. */
async function layout(page: Page) {
  return page.locator('.blend-band').evaluate((band) => {
    const img = band.querySelector('.blend-art img') as HTMLImageElement;
    const ib = img.getBoundingClientRect();
    const fit = getComputedStyle(img).objectPosition.split(' ').map((v) => parseFloat(v) / 100);
    const s = Math.max(ib.width / 1672, ib.height / 941);
    const ox = (ib.width - 1672 * s) * fit[0];
    const oy = (ib.height - 941 * s) * fit[1];
    const badge = { left: ib.left + ox + 997 * s, right: ib.left + ox + 1540 * s, top: ib.top + oy + 174 * s, bottom: ib.top + oy + 753 * s };
    const copy = band.querySelector('.blend-copy')!.getBoundingClientRect();
    const whole = badge.left >= ib.left - 1 && badge.right <= ib.right + 1 && badge.top >= ib.top - 1 && badge.bottom <= ib.bottom + 1;
    const apart = badge.right <= copy.left || badge.left >= copy.right || badge.bottom <= copy.top || badge.top >= copy.bottom;
    return { badge, copy: { left: copy.left, right: copy.right, top: copy.top }, whole, apart, inWindow: badge.left >= 0 && badge.right <= innerWidth };
  });
}

test.describe('the Custom Blend band', () => {
  for (const [code, lang, heading] of [
    ['ar', 'العربية', 'خلطتك، بالنسب اللي بغيتي'],
    ['fr', 'Français', 'Votre blend, dans vos proportions'],
  ] as const) {
    test(`desktop (${code}): text on the left, the badge whole on the right, the example from the catalog`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await open(page, '/');
      await page.locator('.header-tools .lang').getByRole('button', { name: lang }).click();
      await expect(page.locator('html')).toHaveAttribute('dir', code === 'ar' ? 'rtl' : 'ltr');
      const band = page.locator('.blend-band');
      await band.scrollIntoViewIfNeeded();
      await expect(band.getByRole('heading', { level: 2, name: heading })).toBeVisible();
      // the backdrop: decorative, lazy, its size reserved
      const img = band.locator('.blend-art img');
      await expect(img).toHaveAttribute('alt', '');
      await expect(img).toHaveAttribute('loading', 'lazy');
      await expect(img).toHaveAttribute('width', '1672');
      await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
      const l = await layout(page);
      expect(l.whole && l.apart && l.inWindow, JSON.stringify(l)).toBe(true);
      expect(l.copy.right, 'the text column is on the left in every language').toBeLessThan(l.badge.left);
      // the example: three lines, not a table, 50/30/20 as wide as their shares, 500/300/200 g
      await expect(band.locator('table')).toHaveCount(0);
      await expect(band.locator('.blend-lines li')).toHaveCount(3);
      await expect(band.locator('.blend-line-weight')).toHaveText([/500 g/, /300 g/, /200 g/]);
      const widths = await band.locator('.blend-bar span').evaluateAll((s) => s.map((e) => e.getBoundingClientRect().width));
      const total = widths.reduce((a, b) => a + b, 0);
      widths.forEach((w, i) => expect(Math.abs(w / total - [0.5, 0.3, 0.2][i])).toBeLessThan(0.01));
      // nothing to buy, no price promised
      await expect(band).not.toContainText(/prix|price|السعر|درهم|\bDH\b|MAD/i);
      await expect(band.locator('input, button, select, form')).toHaveCount(0);
      await expect(band.getByRole('link')).toHaveAttribute('href', '/custom-blend');
    });
  }

  test.describe('phone', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('the badge once, above the text and whole; nothing overflows; a comfortable button', async ({ page }) => {
      await open(page, '/');
      const band = page.locator('.blend-band');
      await band.scrollIntoViewIfNeeded();
      await expect.poll(() => band.locator('.blend-art img').evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
      const l = await layout(page);
      expect(l.whole && l.apart && l.inWindow, JSON.stringify(l)).toBe(true);
      expect(l.badge.bottom).toBeLessThanOrEqual(l.copy.top);
      await expect(band.locator('img')).toHaveCount(1);
      const button = (await band.locator('.blend-cta').boundingBox())!;
      expect(button.height).toBeGreaterThanOrEqual(44);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    });
  });
});
