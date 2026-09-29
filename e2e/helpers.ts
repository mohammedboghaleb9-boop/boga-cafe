import { expect, type Page } from '@playwright/test';

/** Fails the test on any page error or console error (a missing image or API is allowed). */
export function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource|api\/notify/.test(m.text())) errors.push(`console: ${m.text()}`);
  });
  return { check: () => expect(errors, errors.join('\n')).toEqual([]) };
}

/**
 * Opens a page and waits until it has rendered its main heading: the admin is
 * loaded on demand, so checking right after navigation could check an empty page.
 */
export async function open(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator('h1').first()).toBeVisible();
  // let the entrance animations end (checks read the final colours); scroll-linked ones never end
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.timeline === document.timeline && a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
}

export async function addSignatureBag(page: Page) {
  await page.goto('/product/boga-signature');
  await page.getByRole('button', { name: /Ajouter au panier/ }).click();
}

export async function fillCheckout(page: Page, method: 'cashplus' | 'bank_transfer') {
  await page.goto('/checkout');
  await page.fill('#co-name', 'Client Test');
  await page.fill('#co-phone', '0612345678');
  await page.selectOption('#co-city', 'oujda');
  await page.fill('#co-address', '12 rue Test, quartier Al Qods');
  await page.locator(`input[value=${method}]`).check();
  await page.locator('button[type=submit]').last().click();
  await page.waitForURL(/\/order\//);
}

export async function signIn(page: Page, role: 'owner' | 'manager' | 'staff') {
  await page.goto('/admin');
  await page.selectOption('#login-role', role);
  await page.locator('form button[type=submit]').click();
  await expect(page.locator('#login-role')).toHaveCount(0);
}

/** The page never scrolls sideways (a wide table scrolls inside its own box). */
export async function expectNoSideScroll(page: Page) {
  const { sw, vw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, vw: document.documentElement.clientWidth }));
  expect(sw, `page is ${sw}px wide in a ${vw}px window`).toBeLessThanOrEqual(vw);
}

/**
 * Visible content cut off at the window's edge: boxes, and text that runs out of
 * its box (a nowrap label inside a narrower pill). Decorative images are excluded.
 */
export async function clippedContent(page: Page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const skip = (e: Element | null) => !!e?.closest('.table-wrap, picture, img, svg, .parallax, [aria-hidden="true"], .sr-only');
    const out = new Set<string>();
    const name = (e: Element) => `${e.tagName.toLowerCase()}.${[...e.classList].join('.')} "${(e.textContent ?? '').trim().slice(0, 30)}"`;
    const main = document.querySelector('main');
    if (!main) return ['no <main>'];
    const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent?.trim() || skip(n.parentElement)) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) if (r.width > 0 && (r.right > vw + 0.5 || r.left < -0.5)) out.add(name(n.parentElement!));
    }
    for (const e of main.querySelectorAll('input, select, textarea, button')) {
      const r = e.getBoundingClientRect();
      if (!skip(e) && r.width > 0 && (r.right > vw + 0.5 || r.left < -0.5)) out.add(name(e));
    }
    return [...out];
  });
}
