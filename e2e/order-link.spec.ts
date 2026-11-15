import { expect, test, type Page } from '@playwright/test';
import { answerCatalog, CORS, SUPABASE } from './live';

/**
 * An order opened by its link in another tab, another browser or after an in-app browser was closed (the live-site
 * build): the server gives back no phone or address (get_order_public), so the full message cannot be rebuilt. While
 * the order waits for its confirmation call, the page still offers WhatsApp, with the order number only.
 */
const ID = '10000000-0000-4000-8000-000000000007';
const row = (status: string) => ({
  number: 'BC-2026-0007',
  created_at: '2026-11-15T10:00:00+00:00',
  customer_name: 'Client Test',
  city_id: 'oujda',
  lines: [{ qty: 1, kind: 'product', name: { ar: 'BOGA Signature', fr: 'BOGA Signature', en: 'BOGA Signature' }, size: 250, lineTotal: 65,
    productId: 'boga-signature', unitPrice: 65, composition: [{ grams: 250, percent: 100, originId: 'brazil' }] }],
  weight_kg: 0.25,
  subtotal: 65,
  shipping_fee: 20,
  total: 85,
  payment_method: 'cod',
  payment_status: 'pending',
  status,
});

async function orderByLink(page: Page, status: string) {
  await page.route('https://challenges.cloudflare.com/**', (r) => r.abort('blockedbyclient'));
  await page.route(`${SUPABASE}/**`, (r) => {
    const req = r.request();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    if (new URL(req.url()).pathname.endsWith('/rpc/get_order_public')) {
      return r.fulfill({ headers: CORS, contentType: 'application/json', json: [row(status)] });
    }
    return answerCatalog(r);
  });
  // a fresh browser context: nothing of the order was kept in this tab
  await page.goto(`/order/${ID}`);
  await expect(page.getByRole('heading', { name: /Merci Client/ })).toBeVisible();
}

test('a new order opened by its link: WhatsApp with the order number only, never the customer\'s details', async ({ page }) => {
  await orderByLink(page, 'new');
  await expect(page.getByRole('heading', { name: 'Envoyez-nous le numéro de votre commande sur WhatsApp' })).toBeVisible();
  // the full message needs the phone and address the server never sends back
  await expect(page.locator('.handoff')).toHaveCount(0);
  const href = (await page.getByRole('link', { name: 'Envoyer sur WhatsApp' }).getAttribute('href')) ?? '';
  const url = new URL(href);
  expect(url.origin + url.pathname).toBe('https://wa.me/212609036378');
  expect(url.searchParams.get('text')).toBe('Bonjour BOGA CAFÉ,\n\nCommande BC-2026-0007');
});

test('once confirmed, the order page offers no WhatsApp message', async ({ page }) => {
  await orderByLink(page, 'confirmed');
  await expect(page.getByRole('heading', { name: 'Envoyez-nous le numéro de votre commande sur WhatsApp' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Envoyer sur WhatsApp' })).toHaveCount(0);
});
