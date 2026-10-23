import { expect, test } from '@playwright/test';
import { open } from './helpers';

/**
 * Slow or failing pictures (reported on an iPhone, 2026-10-23): the pouch card showed its sticker alone on a black frame
 * until the photo arrived, and the harvest frame stayed empty. These tests hold the rules that fix it:
 * the sticker appears with its photo, a failed photo leaves the product's name instead, and a lazy image starts
 * before the visitor reaches it (and not much earlier).
 */
test.describe('pictures on slow or failing networks', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the sticker never shows alone: it comes with the loaded photo', async ({ page }) => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    await page.route('**/assets/packshot-*.webp', async (route) => {
      await gate;
      await route.continue();
    });
    try {
      await open(page, '/');
      const card = page.locator('.shelf .pcard').first();
      await card.scrollIntoViewIfNeeded();
      const pouch = card.locator('.pv');
      // the photo is still on its way: a frame, no sticker, no half-drawn photo
      await expect(pouch).toHaveAttribute('data-state', 'loading');
      await expect(pouch.locator('.pv-sticker')).toHaveCount(0);
      release();
      await expect(pouch).toHaveAttribute('data-state', 'ready');
      await expect(pouch.locator('.pv-sticker')).toHaveCount(1);
      expect(await pouch.locator('img.pv-photo').evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
    } finally {
      release();
    }
  });

  test('a photo that does not come: the product name in text, never the sticker alone, no broken image', async ({ page }) => {
    await page.route('**/assets/packshot-*.webp', (route) => route.abort());
    await open(page, '/');
    const card = page.locator('.shelf .pcard').first();
    await card.scrollIntoViewIfNeeded();
    const pouch = card.locator('.pv');
    // two retries (1.5 s and 4 s) before it counts as failed
    await expect(pouch).toHaveAttribute('data-state', 'failed', { timeout: 15_000 });
    await expect(pouch.locator('.pv-sticker')).toHaveCount(0);
    await expect(pouch.locator('img')).toHaveCount(0);
    await expect(pouch.locator('.pv-fallback-title')).not.toBeEmpty();
  });

  test('a photo that comes on the second try is shown with its sticker', async ({ page }) => {
    let tries = 0;
    await page.route('**/assets/packshot-*.webp', (route) => (tries++ === 0 ? route.abort() : route.continue()));
    await open(page, '/');
    const pouch = page.locator('.shelf .pcard').first().locator('.pv');
    await pouch.scrollIntoViewIfNeeded();
    await expect(pouch).toHaveAttribute('data-state', 'ready', { timeout: 10_000 });
    await expect(pouch.locator('.pv-sticker')).toHaveCount(1);
    expect(tries).toBeGreaterThanOrEqual(2);
  });

  test('a lazy image starts before it reaches the screen, but a far one is left alone', async ({ page }) => {
    await open(page, '/');
    const photo = page.locator('.follow img').first();
    // the page's last pictures are far below: still lazy
    await expect(photo).toHaveAttribute('loading', 'lazy');
    const farTop = await photo.evaluate((i) => i.getBoundingClientRect().top + scrollY);
    expect(farTop).toBeGreaterThan(844 * 3);
    // about 1 screen before it: started, though not yet visible
    await page.evaluate((y) => window.scrollTo(0, y), farTop - 844 * 2);
    await expect(photo).toHaveAttribute('loading', 'eager');
    expect(await photo.evaluate((i) => i.getBoundingClientRect().top)).toBeGreaterThan(844);
  });
});
