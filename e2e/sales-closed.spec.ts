import { expect, test, type Page } from '@playwright/test';
import { seedOrigins, seedProducts } from '../src/data/seed/catalog';
import { expectNoSideScroll, open, scanA11y } from './helpers';
import { answerCatalog, CORS, SUPABASE, tables } from './live';

/**
 * The live-site build while the owner keeps the sales closed (settings.salesOpen missing, as on the live database):
 * the site shows its catalog without prices (owner 2026-10-21: showcase_catalog, migration 20261021120000) and offers
 * no way to buy: no cart button, no cart or checkout form, no B2B form, whatever the browser kept. The notice is said
 * once, in the header. The server and the database refuse an order or a request anyway (src/server and supabase/tests).
 */
const NOTICE = {
  fr: 'La boutique est en préparation — les commandes ne sont pas disponibles pour le moment.',
  ar: 'المتجر قيد التجهيز — الطلبات غير متاحة حالياً',
  en: 'The shop is being prepared — orders are not available at the moment.',
};

/**
 * The previous site's catalog as showcase_catalog() answers it: the display fields of the 10 products and 6 origins,
 * nothing of a price, a stock or a date (the same source the live rows were compared with, src/data/seed/catalog.ts).
 */
const showcaseAnswer = {
  products: seedProducts.map((p) => ({
    id: p.id, slug: p.slug, kind: p.kind, name: p.name, tagline: p.tagline, description: p.description, tasting_notes: p.tastingNotes,
    roast_level: p.roastLevel, featured: p.featured, sort_order: p.sortOrder, image_url: null,
    recipe: p.recipe.map((r) => ({ origin_id: r.originId, percent: r.percent })),
  })),
  origins: seedOrigins.map((o) => ({
    id: o.id, name: o.name, country_code: o.countryCode, species: o.species, region: o.region, roast_level: o.roastLevel,
    tasting_notes: o.tastingNotes, custom_blend_enabled: o.customBlendEnabled,
  })),
};
const EMPTY = { products: [], origins: [] };

/**
 * The live site with the sales closed: nothing for sale in the tables (row security), the display function answering
 * `showcase` (null: the function is not there yet, 404), a cart kept from an earlier visit. Returns what was sent to the
 * storefront function.
 */
async function closedSite(page: Page, { showcase = EMPTY as object | null, cart = [] as object[] } = {}) {
  const sent: string[] = [];
  const rpc: string[] = [];
  await page.addInitScript((c) => localStorage.setItem('boga-cart', JSON.stringify(c)), cart);
  await page.route('https://challenges.cloudflare.com/**', (r) => r.abort('blockedbyclient'));
  await page.route(`${SUPABASE}/**`, (r) => {
    const req = r.request();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    const path = new URL(req.url()).pathname;
    const name = path.split('/').at(-1) ?? '';
    if (path.includes('/functions/v1/storefront/')) {
      sent.push(path);
      return r.fulfill({ headers: CORS, json: { ok: false, errors: ['sales_closed'] } });
    }
    if (path.includes('/rest/v1/rpc/')) {
      rpc.push(name);
      if (name === 'showcase_catalog' && showcase) return r.fulfill({ headers: CORS, contentType: 'application/json', json: showcase });
      return r.fulfill({ status: 404, headers: CORS, json: { code: 'PGRST202', message: 'Could not find the function' } });
    }
    if (name === 'site_config') {
      const [row] = tables.site_config as { settings: Record<string, unknown> }[];
      const { salesOpen: _, ...settings } = row.settings; // no salesOpen at all: closed
      // the Custom Blend on with its bag fee, as live has it: no fee may show; the home page's title is the owner's text
      const customBlend = { enabled: true, minPercent: 5, maxOrigins: 4, feeBySize: { 250: 10, 500: 15, 1000: 20 } };
      const closed = { ...row, settings: { ...settings, customBlend }, content: { heroTitle: { ar: 'بوكا كافي', fr: 'BOGA CAFÉ', en: 'BOGA CAFÉ' } } };
      const single = (req.headers()['accept'] ?? '').includes('vnd.pgrst.object');
      return r.fulfill({ headers: CORS, contentType: 'application/json', json: single ? closed : [closed] });
    }
    // hidden rows are not returned to visitors (row security): nothing for sale
    if (['products', 'origins', 'product_recipes', 'shipping_rates'].includes(name)) return r.fulfill({ headers: CORS, contentType: 'application/json', json: [] });
    return answerCatalog(r);
  });
  return { sent, rpc };
}

/** Nothing on the page offers to buy or shows a price. */
async function expectNothingToBuy(page: Page, where: string) {
  await expect(page.getByRole('button', { name: /Ajouter au panier|أضف|Add to cart/ }), where).toHaveCount(0);
  await expect(page.locator('form'), where).toHaveCount(0);
  // prices are written "65 DH" / "65 درهم"
  await expect(page.locator('main'), where).not.toContainText(/\d\s*(DH|MAD|درهم)/);
  // no stock state (the Custom Blend's plain "unavailable" says an origin is not offered in a blend, as before)
  await expect(page.locator('.pill-ok, .pill-bad:not(.pill-plain)'), where).toHaveCount(0);
}

test.describe('sales closed, the catalog shown without prices', () => {
  test('every page shows the catalog once, with one notice, nothing to buy, not indexed', async ({ page }) => {
    const { rpc } = await closedSite(page, { showcase: showcaseAnswer });
    for (const path of ['/', '/shop', '/single-origin', '/custom-blend', '/b2b', '/contact', '/product/boga-signature']) {
      await open(page, path);
      await expect(page.locator('.sales-notice'), path).toHaveText(NOTICE.fr);
      await expect(page.locator('[role=status]').filter({ hasText: 'commandes' }), path).toHaveCount(0); // said once, in the header
      await expect(page.locator('meta[name="robots"]'), path).toHaveAttribute('content', 'noindex');
      await expectNothingToBuy(page, path);
      await expectNoSideScroll(page);
    }
    expect(rpc.every((n) => n === 'showcase_catalog')).toBe(true);

    await open(page, '/shop');
    await expect(page.locator('.pcard')).toHaveCount(10);
    for (const p of seedProducts) await expect(page.getByRole('heading', { name: p.name.fr, exact: true })).toBeVisible();
    await scanA11y(page, 'shop, catalog shown');

    await open(page, '/single-origin');
    await expect(page.locator('.origin-chip')).toHaveCount(6);
    await expect(page.locator('.pcard')).toHaveCount(4);

    await open(page, '/b2b');
    await expect(page.locator('.pcard')).toHaveCount(3);

    await open(page, '/product/boga-signature');
    await expect(page.locator('h1')).toHaveText('BOGA Signature');
    await expect(page.getByText(seedProducts[0].description.fr)).toBeVisible();
    await expect(page.locator('.recipe li')).toHaveCount(3);
    await expect(page.locator('.buy')).toHaveCount(0);
    await scanA11y(page, 'product, catalog shown');

    // the builder stays to compose and look: six origins, Ethiopia not in the blend, no price, fee or cart button
    await open(page, '/custom-blend');
    await expect(page.locator('.origin-tile')).toHaveCount(6);
    await expect(page.locator('.origin-tile').filter({ hasText: 'Éthiopie' })).toContainText('Indisponible');
    await expect(page.locator('.summary-price')).toHaveCount(0);
    await scanA11y(page, 'custom blend, catalog shown');
  });

  test('a cart kept from before: no line, total or form in the cart or the checkout, nothing sent', async ({ page }) => {
    const { sent } = await closedSite(page, {
      showcase: showcaseAnswer,
      cart: [{ id: 'l1', type: 'product', productId: 'boga-signature', size: 1000, qty: 11 }],
    });
    for (const path of ['/cart', '/checkout']) {
      await open(page, path);
      await expect(page.getByText('Découvrez nos cafés et contactez-nous pour toute question.'), path).toBeVisible();
      await expect(page.getByRole('link', { name: 'Contact' }).last(), path).toHaveAttribute('href', '/contact');
      await expect(page.locator('.cart-subtotal, .b2b-box, form'), path).toHaveCount(0);
      await expectNothingToBuy(page, path);
    }
    expect(sent).toEqual([]);
  });

  test('the display function not there yet (or failing): the site stays up with its empty lists', async ({ page }) => {
    await closedSite(page, { showcase: null });
    await open(page, '/shop');
    await expect(page.getByText('Aucun café dans cette catégorie pour le moment.')).toBeVisible();
    await open(page, '/custom-blend');
    await expect(page.locator('.notice-warn')).toHaveText('Aucune origine disponible pour le moment.');
    await expect(page.locator('.sales-notice')).toHaveText(NOTICE.fr);
  });

  for (const [locale, width] of [['ar-MA', 390], ['en-US', 320]] as const) {
    test.describe(`${width}px ${locale}`, () => {
      test.use({ locale, viewport: { width, height: 844 } });
      test('the notice in its language, the catalog inside the window', async ({ page }) => {
        await closedSite(page, { showcase: showcaseAnswer });
        await open(page, '/shop');
        await expect(page.locator('.sales-notice')).toHaveText(NOTICE[locale.slice(0, 2) as 'ar' | 'en']);
        await expect(page.locator('.pcard')).toHaveCount(10);
        await expectNothingToBuy(page, '/shop');
        await expectNoSideScroll(page);
        await open(page, '/product/oriental-intense');
        await expectNoSideScroll(page);
        await page.screenshot({ path: `test-results/showcase-product-${locale}-${width}.png`, fullPage: true });
      });
    });
  }
});

/** A product that is for sale (active) still shows no price while the sales are closed. */
test('sales closed: even a product for sale shows no price and no cart button', async ({ page }) => {
  await closedSite(page);
  await page.route(`${SUPABASE}/rest/v1/products*`, (r) =>
    r.request().method() === 'OPTIONS'
      ? r.fulfill({ status: 204, headers: CORS })
      : r.fulfill({ headers: CORS, contentType: 'application/json', json: tables.products }),
  );
  await page.route(`${SUPABASE}/rest/v1/origins*`, (r) =>
    r.request().method() === 'OPTIONS' ? r.fulfill({ status: 204, headers: CORS }) : r.fulfill({ headers: CORS, contentType: 'application/json', json: tables.origins }),
  );
  await open(page, '/product/boga-signature');
  await expect(page.locator('h1')).toHaveText('BOGA Signature');
  await expectNothingToBuy(page, '/product/boga-signature');
  await open(page, '/shop');
  await expect(page.locator('.pcard')).toHaveCount(1);
  await expectNothingToBuy(page, '/shop');
});
