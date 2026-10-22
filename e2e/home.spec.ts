import { expect, test } from '@playwright/test';
import { open, watchErrors } from './helpers';

test.describe('home page', () => {
  test('the video is silent, inline and looping over its still; the ribbon says its facts once', async ({ page }) => {
    const errors = watchErrors(page);
    await open(page, '/');
    const video = page.locator('.hero video');
    await expect(video).toHaveCount(1);
    expect(await video.evaluate((v: HTMLVideoElement) => ({ muted: v.muted, inline: v.playsInline, loop: v.loop }))).toEqual({
      muted: true,
      inline: true,
      loop: true,
    });
    await expect(page.locator('.hero picture img')).toBeVisible();
    await expect(page.locator('.ribbon .sr-only li')).toHaveCount(4);
    await expect(page.locator('.ribbon-track')).toHaveAttribute('aria-hidden', 'true');
    errors.check();
  });

  test('less motion: no video is downloaded and the ribbon stands still', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const videos: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('.mp4')) videos.push(r.url());
    });
    await open(page, '/');
    await expect(page.locator('.hero video')).toHaveCount(0);
    await expect(page.locator('.hero picture img')).toBeVisible();
    expect(await page.locator('.ribbon-track').evaluate((e) => getComputedStyle(e).animationName)).toBe('none');
    expect(videos).toEqual([]);
  });

  test('the language pill: Arabic right to left, kept on the next page', async ({ page }) => {
    await open(page, '/');
    const arabic = page.locator('.header-tools .lang').getByRole('button', { name: 'العربية' });
    await arabic.click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(arabic).toHaveAttribute('aria-pressed', 'true');
    await open(page, '/shop');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  });

  test.describe('phone', () => {
    test.use({ viewport: { width: 390, height: 800 } });

    test('one language button opens the three languages', async ({ page }) => {
      await open(page, '/');
      const chip = page.locator('.lang-chip');
      await chip.click();
      await expect(chip).toHaveAttribute('aria-expanded', 'true');
      await page.locator('#lang-list').getByRole('button', { name: /English/ }).click();
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      await expect(page.locator('#lang-list')).toBeHidden();
    });
  });
});
