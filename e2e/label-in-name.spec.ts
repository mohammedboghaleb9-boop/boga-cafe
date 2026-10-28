import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { open } from './helpers';

/**
 * WCAG 2.5.3 Label in Name (P6.10). The axe rule is experimental, so it is switched on here by name;
 * its result also depends on the axe version (Lighthouse bundles a newer one than this repo), so the
 * names that were wrong are checked directly as well.
 */
const RULE = 'label-content-name-mismatch';
const pages = ['/', '/shop', '/single-origin', '/b2b', '/product/boga-signature'];
const viewports = [
  { name: 'desktop', width: 1350, height: 900 },
  { name: 'phone', width: 390, height: 844 },
];

/** The page really is in the language under test: the browser locale only counts if the site follows it. */
async function expectSiteLanguage(page: Page, locale: string) {
  const lang = locale.slice(0, 2);
  await expect(page.locator('html')).toHaveAttribute('lang', lang);
  await expect(page.locator('html')).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
}

async function scan(page: Page, where: string) {
  const r = await new AxeBuilder({ page }).withRules([RULE]).analyze();
  const found = r.violations.flatMap((v) => v.nodes.map((n) => `${where}: ${v.id} — ${n.target.join(' ')}`));
  expect(found, found.join('\n')).toEqual([]);
}

for (const locale of ['fr-FR', 'ar-MA', 'en-US']) {
  test.describe(`label in name ${locale}`, () => {
    test.use({ locale });

    for (const vp of viewports) {
      test(`the rule finds nothing on the public pages (${vp.name})`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        for (const path of pages) {
          await open(page, path);
          await expectSiteLanguage(page, locale);
          await scan(page, `${path} ${vp.name}`);
        }
      });
    }

    test('a product card is named by its text: title, tagline, notes and button', async ({ page }) => {
      await open(page, '/shop');
      await expectSiteLanguage(page, locale);
      const card = page.locator('a.pcard').first();
      const parts = [
        await card.getByRole('heading').textContent(),
        await card.locator('.pcard-tag').textContent(),
        await card.locator('.pcard-notes span').textContent(),
        await card.locator('.pcard-cta').textContent(),
      ].map((x) => (x ?? '').trim());
      for (const part of parts) expect(part).not.toBe('');
      // in reading order: title, tagline, notes, button
      await expect(card).toHaveAccessibleName(new RegExp(parts.map(escape).join('.*')));
    });

    test('the social buttons keep a space between the platform and the account', async ({ page }) => {
      await open(page, '/');
      await expectSiteLanguage(page, locale);
      const pills = page.locator('.channel-pill');
      expect(await pills.count()).toBeGreaterThan(0);
      for (const pill of await pills.all()) {
        const text = (await pill.textContent()) ?? '';
        const name = (await pill.getAttribute('aria-label')) ?? '';
        expect(text.replace(/\s+/g, ' ').trim(), 'text content has the same words as the name').toBe(name);
      }
    });
  });
}

// the visible codes do not depend on the language, so this runs once (the site opens in French here)
  test('the language buttons are named from the code shown on them', async ({ page }) => {
    await page.setViewportSize({ width: 1350, height: 900 });
    await open(page, '/');
    await expectSiteLanguage(page, 'fr-FR');
    const buttons = page.locator('.header-tools .lang button');
    await expect(buttons).toHaveCount(3);
    for (const [i, code] of ['AR', 'FR', 'EN'].entries()) {
      await expect(buttons.nth(i)).toHaveAccessibleName(new RegExp(`^${code} `));
      await expect(buttons.nth(i).locator('span[aria-hidden]')).toHaveText(code);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    const chip = page.locator('.lang-chip');
    const code = (await chip.locator('span[aria-hidden]').textContent()) ?? '';
    expect(code).toMatch(/^(AR|FR|EN)$/);
    await expect(chip).toHaveAccessibleName(new RegExp(`^${code} `));
  });

function escape(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
