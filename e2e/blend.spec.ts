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
    // whole: inside the picture and inside the frame that clips it
    const art = band.querySelector('.blend-art')!.getBoundingClientRect();
    const inside = (r: DOMRect) => badge.left >= r.left - 1 && badge.right <= r.right + 1 && badge.top >= r.top - 1 && badge.bottom <= r.bottom + 1;
    const whole = inside(ib) && inside(art);
    const apart = badge.right <= copy.left || badge.left >= copy.right || badge.bottom <= copy.top || badge.top >= copy.bottom;
    // the picture always reaches the frame's right edge (no bare strip beside it)
    const covers = ib.right >= art.right - 1;
    return { badge, copy: { left: copy.left, right: copy.right, top: copy.top }, whole, apart, covers, inWindow: badge.left >= 0 && badge.right <= innerWidth };
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
      // the backdrop: decorative, its size reserved, lazy while the band is still far below
      // (nearLoad.ts turns a lazy image eager once it is within 1.2 screens)
      const img = band.locator('.blend-art img');
      const far = await img.evaluate((i: HTMLImageElement) => ({ screens: i.getBoundingClientRect().top / innerHeight, loading: i.loading }));
      expect(far.screens, 'the band starts well below the first screen').toBeGreaterThan(2.2);
      expect(far.loading).toBe('lazy');
      await band.scrollIntoViewIfNeeded();
      await expect(band.getByRole('heading', { level: 2, name: heading })).toBeVisible();
      await expect(img).toHaveAttribute('alt', '');
      await expect(img).toHaveAttribute('width', '1672');
      await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
      const l = await layout(page);
      expect(l.whole && l.apart && l.covers && l.inWindow, JSON.stringify(l)).toBe(true);
      expect(l.copy.right, 'the text column is on the left in every language').toBeLessThan(l.badge.left);
      // the example: three lines, not a table, 50/30/20 as wide as their shares, 500/300/200 g
      await expect(band.locator('table')).toHaveCount(0);
      await expect(band.locator('.blend-lines li')).toHaveCount(3);
      await expect(band.locator('.blend-line-weight')).toHaveText([/(^|· )500 g$/, /(^|· )300 g$/, /(^|· )200 g$/]);
      const widths = await band.locator('.blend-bar span').evaluateAll((s) => s.map((e) => e.getBoundingClientRect().width));
      const total = widths.reduce((a, b) => a + b, 0);
      widths.forEach((w, i) => expect(Math.abs(w / total - [0.5, 0.3, 0.2][i])).toBeLessThan(0.01));
      // nothing to buy, no price promised
      await expect(band).not.toContainText(/prix|price|السعر|درهم/i);
      await expect(band).not.toContainText(/\b(DH|MAD)\b/);
      await expect(band.locator('input, button, select, form')).toHaveCount(0);
      await expect(band.getByRole('link')).toHaveAttribute('href', '/custom-blend');
    });
  }

  // the tightest widths: the widest picture above the text (1279), the two zones at their narrowest (1280)
  test('around 1280 px (ar and fr): the badge whole, never under the text', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await open(page, '/');
    for (const lang of ['العربية', 'Français']) {
      await page.locator('.header-tools .lang').getByRole('button', { name: lang }).click();
      for (const width of [1279, 1280]) {
        await page.setViewportSize({ width, height: 800 });
        const band = page.locator('.blend-band');
        await band.scrollIntoViewIfNeeded();
        await expect.poll(() => band.locator('.blend-art img').evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
        const l = await layout(page);
        expect(l.whole && l.apart && l.covers && l.inWindow, `${lang} ${width}: ${JSON.stringify(l)}`).toBe(true);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      }
    }
  });

  test.describe('phone', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('the badge once, centred above the text and whole; nothing overflows; a comfortable button', async ({ page }) => {
      await open(page, '/');
      const band = page.locator('.blend-band');
      await band.scrollIntoViewIfNeeded();
      await expect.poll(() => band.locator('.blend-art img').evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
      const l = await layout(page);
      expect(l.whole && l.apart && l.covers && l.inWindow, JSON.stringify(l)).toBe(true);
      expect(l.badge.bottom).toBeLessThanOrEqual(l.copy.top);
      // in the middle of the screen
      expect(Math.abs((l.badge.left + l.badge.right) / 2 - 195)).toBeLessThan(4);
      await expect(band.locator('img')).toHaveCount(1);
      const button = (await band.locator('.blend-cta').boundingBox())!;
      expect(button.height).toBeGreaterThanOrEqual(44);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    });

    test('320 px in French (the longest names): each line readable, nothing on top of another', async ({ page }) => {
      // the language buttons are in the header on a wide screen; the choice stays when the screen narrows
      await page.setViewportSize({ width: 1280, height: 800 });
      await open(page, '/');
      await page.locator('.header-tools .lang').getByRole('button', { name: 'Français' }).click();
      await expect(page.locator('html')).toHaveAttribute('lang', /^fr/);
      await page.setViewportSize({ width: 320, height: 640 });
      const lines = page.locator('.blend-lines li');
      await lines.first().scrollIntoViewIfNeeded();
      const clashes = await lines.evaluateAll((items) =>
        items.flatMap((li) => {
          const parts = [...li.children].map((c) => c.getBoundingClientRect());
          const name = li.querySelector('.blend-line-name')!;
          const out = name.scrollWidth > name.clientWidth + 1 ? [`${name.textContent} overflows`] : [];
          parts.forEach((a, i) => parts.slice(i + 1).forEach((b) => {
            if (a.right > b.left + 1 && b.right > a.left + 1 && a.bottom > b.top + 1 && b.bottom > a.top + 1) out.push(`${li.textContent}: parts overlap`);
          }));
          return out;
        }),
      );
      expect(clashes).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    });
  });
});
