import { expect, test } from '@playwright/test';
import { open, signIn, watchErrors } from './helpers';

test.describe('home page', () => {
  test('each public page names its own canonical address; the cart and an unknown product have none', async ({ page }) => {
    const canonical = page.locator('link[rel="canonical"]');
    await open(page, '/');
    await expect(canonical).toHaveAttribute('href', 'https://bogacafe.ma/');
    await open(page, '/shop');
    await expect(canonical).toHaveAttribute('href', 'https://bogacafe.ma/shop');
    await open(page, '/product/boga-signature');
    await expect(canonical).toHaveAttribute('href', 'https://bogacafe.ma/product/boga-signature');
    await open(page, '/cart');
    await expect(canonical).toHaveCount(0);
    await open(page, '/product/does-not-exist');
    await expect(canonical).toHaveCount(0);
  });

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

  // the owner's order (2026-10-22): start group, short intro, signature blends, origins, Custom Blend, how it is made, B2B, follow
  const ORDER = ['.hero', '.paths', '.ribbon', '#about', '.shelf', '.origins-band', '.blend-band', '.story', '.b2b-band', '.follow'];
  const INTRO = {
    fr: { lang: 'Français', intro: 'définit ses recettes, ses proportions et les spécifications', how: 'Comment est préparé le café BOGA' },
    en: { lang: 'English', intro: 'defines its recipes, proportions and the specification', how: 'How BOGA coffee is made' },
    ar: { lang: 'العربية', intro: 'تحدد BOGA CAFÉ وصفاتها ونسب خلطاتها', how: 'كيف تُحضَّر قهوة BOGA' },
  } as const;
  for (const [code, x] of Object.entries(INTRO)) {
    test(`section order, one short intro and the steps below (${code})`, async ({ page }) => {
      const errors = watchErrors(page);
      await open(page, '/');
      await page.locator('.header-tools .lang').getByRole('button', { name: x.lang }).click();
      await expect(page.locator('html')).toHaveAttribute('lang', code);
      const tops = await page.evaluate((sels) => sels.map((q) => document.querySelector(q)?.getBoundingClientRect().top ?? null), ORDER);
      expect(tops.every((y) => y !== null), `a section is missing: ${JSON.stringify(tops)}`).toBe(true);
      expect(tops).toEqual([...tops].sort((a, b) => (a as number) - (b as number)));
      // the intro: short, no picture, no steps; said once on the page
      const intro = page.locator('#about');
      await expect(intro).toContainText(x.intro);
      await expect(intro.locator('img, picture, ol')).toHaveCount(0);
      expect(((await intro.locator('p').innerText()).match(/\S+/g) ?? []).length).toBeLessThan(60);
      await expect(page.getByText(x.intro)).toHaveCount(1);
      // no roasting claim of our own
      await expect(intro).not.toContainText(/Oujda|وجدة/);
      // the details: titled, five steps, the existing photos, no repeat of the intro
      const how = page.locator('.story');
      await expect(how.getByRole('heading', { level: 2, name: x.how })).toBeVisible();
      await expect(how.locator('.process li')).toHaveCount(5);
      await expect(how.locator('img').first()).toBeVisible();
      await expect(how.locator('p')).toHaveCount(0);
      // one h2 each, no empty ones
      const h2 = await page.locator('main h2').allInnerTexts();
      expect(new Set(h2).size).toBe(h2.length);
      // the links of the start group still go to their pages
      await expect(page.locator('.paths a')).toHaveCount(3);
      errors.check();
    });
  }

  // the origins section (owner's reference 2026-10-22): six cards from the catalog beside the harvest photo
  const ORIGINS = {
    fr: { lang: 'Français', title: 'Les origines du café', all: 'Voir toutes les origines', roast: { Claire: 1, Moyenne: 2, 'Moyenne-foncée': 3, Foncée: 4 } },
    ar: { lang: 'العربية', title: 'مصادر القهوة', all: 'شوف المصادر كاملين', roast: { فاتح: 1, متوسط: 2, 'متوسط إلى داكن': 3, داكن: 4 } },
  } as const;
  for (const [code, x] of Object.entries(ORIGINS)) {
    test(`origins: catalog cards on the left, the harvest photo on the right (${code})`, async ({ page }) => {
      const errors = watchErrors(page);
      await page.setViewportSize({ width: 1440, height: 900 });
      await open(page, '/');
      await page.locator('.header-tools .lang').getByRole('button', { name: x.lang }).click();
      await expect(page.locator('html')).toHaveAttribute('dir', code === 'ar' ? 'rtl' : 'ltr');
      const band = page.locator('.origins-band');
      await expect(band.getByRole('heading', { level: 2, name: x.title })).toBeVisible();
      const cards = band.locator('.origin-card');
      await expect(cards).toHaveCount(6);
      // the lead counts the origins on show, and says nothing about stock
      await expect(band.locator('.origins-lead')).toHaveText(code === 'ar' ? /^6 مصادر ديال القهوة/ : /^6 origines de café, chacune avec ses arômes/);
      // the line drawings are decoration only: hidden from screen readers, no text
      await expect(band.locator('.origins-decor')).toHaveAttribute('aria-hidden', 'true');
      await expect(band.locator('.origins-decor')).toHaveText('');
      for (const card of await cards.all()) {
        await expect(card.locator('h3 .flag')).toHaveCount(1);
        await expect(card.locator('.origin-meta')).toContainText(/Arabica|Robusta|أرابيكا|روبوستا/);
        await expect(card.locator('.origin-notes')).not.toBeEmpty();
        // the lit beans follow the roast level written on the card
        const levels: Record<string, number> = x.roast;
        // the level's name is the text after the screen-reader prefix
        const roast = await card.locator('.origin-roast-name').evaluate((e) => (e.lastChild?.textContent ?? '').trim());
        expect(levels[roast], roast).toBeGreaterThan(0);
        await expect(card.locator('.origin-beans .is-on')).toHaveCount(levels[roast]);
      }
      // nothing to buy: no price, no stock figure, no form
      await expect(band).not.toContainText(/\d\s?(DH|MAD|درهم|kg|كلغ|كغ)/i);
      await expect(band.locator('form, button')).toHaveCount(0);
      await expect(band.getByRole('link', { name: x.all })).toHaveAttribute('href', '/single-origin');
      const photo = band.locator('.origins-photo img');
      // lazy, or already started because the section is near the screen (src/shared/ui/nearLoad.ts)
      await expect(photo).toHaveAttribute('loading', /^(lazy|eager)$/);
      await expect(photo).toHaveAttribute('width', '1046');
      await expect(photo).not.toHaveAttribute('alt', '');
      const [p, list, all, title] = await Promise.all(['.origins-photo', '.origin-cards', '.origins-all', 'h2'].map((q) => band.locator(q).boundingBox()));
      expect(p!.x, 'the photo is on the right in every language').toBeGreaterThan(list!.x + list!.width);
      // the button sits beside the title, as in the reference, not under it
      expect(all!.y).toBeLessThan(title!.y + title!.height);
      errors.check();
    });
  }

  test('origins on a tablet: title, photo, then two columns of cards (ar)', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await open(page, '/');
    await page.locator('.header-tools .lang').getByRole('button', { name: 'العربية' }).click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const band = page.locator('.origins-band');
    const [head, photo, list] = await Promise.all(['.origins-head-text', '.origins-photo', '.origin-cards'].map((q) => band.locator(q).boundingBox()));
    expect(head!.y + head!.height).toBeLessThanOrEqual(photo!.y);
    expect(photo!.y + photo!.height).toBeLessThanOrEqual(list!.y);
    const [first, second] = [await band.locator('.origin-card').nth(0).boundingBox(), await band.locator('.origin-card').nth(1).boundingBox()];
    expect(second!.y).toBe(first!.y);
    // right to left: the first origin on the right
    expect(first!.x).toBeGreaterThan(second!.x);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(768);
  });

  for (const [name, size] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]] as const) {
    test(`origins reading order on ${name}: title, photo, the six origins, then the "see all" link; no focus jump`, async ({ page }) => {
      await page.setViewportSize(size);
      await open(page, '/');
      const order = await page.locator('.origins-band').evaluate((band) => {
        const pos = (q: string) => band.querySelector(q)!;
        const follows = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
        const link = pos('.origins-all');
        return {
          titleFirst: follows(pos('h2'), pos('.origins-photo')) && follows(pos('.origins-photo'), pos('.origin-cards')),
          linkLast: follows(pos('.origin-cards'), link) && ![...band.querySelectorAll('*')].some((e) => follows(link, e) && e.nodeType === 1 && e.matches('a, button, input, [tabindex]')),
          focusable: [...band.querySelectorAll('a, button, input, select, textarea, [tabindex]')].map((e) => e.className),
        };
      });
      expect(order.titleFirst).toBe(true);
      expect(order.linkLast).toBe(true);
      // the link is the only thing in the section the keyboard can reach, so the order never jumps
      expect(order.focusable).toEqual([expect.stringContaining('origins-all')]);
      // and what is drawn matches that order on a phone: the link is below the list
      if (name === 'phone') {
        const band = page.locator('.origins-band');
        const [list, all] = await Promise.all([band.locator('.origin-cards').boundingBox(), band.locator('.origins-all').boundingBox()]);
        expect(all!.y).toBeGreaterThanOrEqual(list!.y + list!.height);
      }
      // the link takes the keyboard focus where it is drawn, and goes to the Single Origin page
      await page.locator('.origins-all').focus();
      await expect(page.locator('.origins-all')).toBeFocused();
      await expect(page.locator('.origins-all')).toHaveAttribute('href', '/single-origin');
    });
  }

  test('the intro stays editable from the Admin About fields', async ({ page }) => {
    await signIn(page, 'owner');
    await open(page, '/admin/content');
    await page.locator('#c-at-fr').fill('Titre modifié');
    await page.locator('#c-ax-fr').fill('Texte modifié depuis l’administration.');
    await page.locator('.admin-head .btn-primary').click();
    await expect(page.locator('.admin-head .pill-ok').first()).toBeVisible();
    await page.goto('/');
    await page.evaluate(() => localStorage.setItem('boga-locale', 'fr'));
    await page.reload();
    await expect(page.locator('#about h2')).toHaveText('Titre modifié');
    await expect(page.locator('#about .lead')).toHaveText('Texte modifié depuis l’administration.');
  });

  test('"About" in the header lands on the short intro', async ({ page }) => {
    await open(page, '/');
    await page.locator('.nav-top', { hasText: /^(About|À propos|من نحن)$/ }).first().click();
    await expect(page.locator('#about')).toBeInViewport();
    await expect(page.locator('#about .lead')).toBeVisible();
  });

  test.describe('phone', () => {
    test.use({ viewport: { width: 390, height: 800 } });

    for (const [code, lang] of [['fr', 'Français'], ['ar', 'العربية']] as const) {
      test(`origins on a phone: one compact sheet, rows that line up, the button last (${code})`, async ({ page }) => {
        await open(page, '/');
        // phones: one language button opens the list
        await page.locator('.lang-chip').click();
        await page.locator('#lang-list').getByRole('button', { name: new RegExp(lang) }).click();
        await expect(page.locator('html')).toHaveAttribute('dir', code === 'ar' ? 'rtl' : 'ltr');
        const band = page.locator('.origins-band');
        const box = (q: string) => band.locator(q).first().boundingBox();
        const [head, photo, list, all] = await Promise.all(['.origins-head-text', '.origins-photo', '.origin-cards', '.origins-all'].map(box));
        expect(head!.y + head!.height).toBeLessThanOrEqual(photo!.y);
        // the photo is the top of the sheet, the six rows its body
        expect(Math.abs(photo!.y + photo!.height - list!.y)).toBeLessThan(1);
        expect(all!.y).toBeGreaterThanOrEqual(list!.y + list!.height);
        expect(all!.height, 'a comfortable touch target').toBeGreaterThanOrEqual(44);
        const rows = band.locator('.origin-card');
        await expect(rows).toHaveCount(6);
        // everything to compare is on screen, not behind a hover; the round photo is left to the large screens
        for (const q of ['.origin-name', '.origin-species', '.origin-notes', '.origin-roast-name', '.origin-beans', '.origin-region']) {
          for (const row of await rows.all()) await expect(row.locator(q)).toBeVisible();
        }
        await expect(band.locator('.origin-roast-photo').first()).toBeHidden();
        // species, beans and the roast name start at the same place in every row, even beside a long name
        await rows.first().locator('.origin-name span').evaluate((e) => (e.textContent = 'République démocratique du Congo, Kivu'));
        const lines = await rows.evaluateAll((els) => {
          const rtl = document.documentElement.dir === 'rtl';
          const start = (r: DOMRect) => Math.round(rtl ? r.right : r.left);
          const end = (r: DOMRect) => Math.round(rtl ? r.left : r.right);
          return els.map((e) => {
            const at = (q: string) => e.querySelector(q)!.getBoundingClientRect();
            return [end(at('.origin-species')), start(at('.origin-beans')), start(at('.origin-roast-name'))].join('|');
          });
        });
        expect(new Set(lines).size, lines.join(' / ')).toBe(1);
        // shorter than the stacked cards it replaced (1731 px at 390 on live data)
        expect((await band.boundingBox())!.height).toBeLessThan(1500);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
      });
    }

    test('one language button opens the three languages', async ({ page }) => {
      await open(page, '/');
      const chip = page.locator('.lang-chip');
      await chip.click();
      await expect(chip).toHaveAttribute('aria-expanded', 'true');
      await page.locator('#lang-list').getByRole('button', { name: /English/ }).click();
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      await expect(page.locator('#lang-list')).toBeHidden();
      // keyboard and screen reader users stay where they were
      await expect(chip).toBeFocused();
    });

    test('the WhatsApp button steps aside while a button is under it, and comes back', async ({ page }) => {
      await open(page, '/');
      const whatsapp = page.locator('.wa-fab');
      const recheck = () => page.evaluate(() => window.dispatchEvent(new Event('scroll')));
      // a still surface over the page: nothing to tap under the button
      await page.evaluate(() => {
        const veil = Object.assign(document.createElement('div'), { id: 'veil' });
        veil.style.cssText = 'position:fixed;inset:0;z-index:45';
        document.body.append(veil);
      });
      await recheck();
      await expect(whatsapp).toBeVisible();
      const box = (await whatsapp.boundingBox())!;
      await page.evaluate(({ x, y }) => {
        const probe = Object.assign(document.createElement('button'), { id: 'probe', textContent: 'probe' });
        probe.style.cssText = `position:fixed;left:${x - 20}px;top:${y - 20}px;width:40px;height:40px;z-index:46`;
        document.body.append(probe);
      }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
      await recheck();
      await expect(whatsapp).toBeHidden();
      await page.evaluate(() => document.getElementById('probe')?.remove());
      await recheck();
      await expect(whatsapp).toBeVisible();
    });

    test('the menu link to the short intro, on the home page itself, closes the menu and shows it', async ({ page }) => {
      await open(page, '/');
      await page.locator('.menu-btn').click();
      await page.locator('#mobile-nav a[href$="#about"]').click();
      await expect(page.locator('#mobile-nav')).toBeHidden();
      await expect(page.locator('#about')).toBeInViewport();
    });
  });
});
