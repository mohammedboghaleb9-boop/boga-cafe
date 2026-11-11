/**
 * Cash on delivery (owner 2026-11-10), in the demo build: the customer orders with a second phone and pays the
 * carrier; staff moves the delivery; only the owner records the carrier's collection, then BOGA's receipt; a failed
 * delivery keeps its reason. Phone first (390 px), as the shop is mobile-first.
 */
import { expect, test, type Page } from '@playwright/test';
import { addSignatureBag, fillCheckout, signIn, watchErrors } from './helpers';

test.use({ viewport: { width: 390, height: 844 } });

async function codOrder(page: Page) {
  await addSignatureBag(page);
  await fillCheckout(page, 'cod');
  return page.url().split('/order/')[1];
}

const step = (page: Page, status: string) => page.getByRole('button', { name: `Passer à : ${status}` }).click();

test('a cash on delivery order: no payment step, the second phone in the message, nothing to report', async ({ page }) => {
  const errors = watchErrors(page);
  await addSignatureBag(page);
  await page.goto('/checkout');
  await expect(page.locator('input[value=cod]')).toBeEnabled();
  // no "no payment on delivery" line while it is offered
  await expect(page.getByText(/Pas de paiement à la livraison/)).toHaveCount(0);
  // the second phone is required, checked like the first
  await page.fill('#co-name', 'Client Test');
  await page.fill('#co-phone', '0612345678');
  await page.selectOption('#co-city', 'oujda');
  await page.fill('#co-address', '12 rue Test, quartier Al Qods');
  await page.locator('input[value=cod]').check();
  await page.locator('button[type=submit]').last().click();
  await expect(page.locator('#co-phone-alt')).toHaveAttribute('aria-invalid', 'true');
  await expect(page).toHaveURL(/\/checkout$/);
  await page.fill('#co-phone-alt', '07 12 34 56 78');
  await page.locator('button[type=submit]').last().click();
  await page.waitForURL(/\/order\//);

  await expect(page.getByText(/À payer au livreur à la réception/)).toBeVisible();
  await expect(page.locator('form.report')).toHaveCount(0);
  const message = decodeURIComponent((await page.locator('.handoff-wa').getAttribute('href')) ?? '');
  expect(message).toContain('Téléphone 2 : +212712345678');
  expect(message).toMatch(/Paiement : Paiement à la livraison \(\d+ DH à encaisser à la livraison\)/);
  // a phone screen: nothing wider than the page
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  errors.check();
});

test('delivery, collection and receipt are three steps, the money the owner\'s alone', async ({ page, context }) => {
  const id = await codOrder(page);

  const staff = await context.newPage();
  await signIn(staff, 'staff');
  await staff.goto(`/admin/orders/${id}`);
  await expect(staff.getByText('+212712345678')).toBeVisible();
  for (const s of ['Confirmée', 'En production', 'Expédiée', 'Livrée']) await step(staff, s);
  await expect(staff.locator('.admin-head .pill').first()).toHaveText('Livrée');
  await expect(staff.getByRole('button', { name: 'Encaissé par le transporteur' })).toHaveCount(0);
  await expect(staff.getByText('Seul le propriétaire enregistre les paiements.')).toBeVisible();

  const owner = await context.newPage();
  await signIn(owner, 'owner');
  await owner.goto(`/admin/orders/${id}`);
  await expect(owner.getByRole('button', { name: 'Reçu par BOGA' })).toHaveCount(0);
  await owner.getByRole('button', { name: 'Encaissé par le transporteur' }).click();
  await expect(owner.locator('.admin-head .pill').nth(1)).toHaveText('Chez le transporteur');
  await owner.goto('/admin');
  await expect(owner.locator('.kpi', { hasText: 'Chez le transporteur (1)' })).toBeVisible();
  await owner.goto(`/admin/orders/${id}`);
  await owner.getByRole('button', { name: 'Reçu par BOGA' }).click();
  await expect(owner.locator('.admin-head .pill').nth(1)).toHaveText('Payé');
  await owner.goto('/admin');
  await expect(owner.locator('.kpi', { hasText: 'Chez le transporteur (0)' })).toBeVisible();
});

test('a failed delivery keeps its reason, and comes back without touching the stock', async ({ page, context }) => {
  const id = await codOrder(page);
  const owner = await context.newPage();
  await signIn(owner, 'owner');
  await owner.goto(`/admin/orders/${id}`);
  for (const s of ['Confirmée', 'En production', 'Expédiée']) await step(owner, s);

  await owner.getByRole('button', { name: 'Livraison échouée' }).click();
  await expect(owner.locator('#od-failure')).toHaveAttribute('aria-invalid', 'true');
  await owner.fill('#od-failure', 'Refusé par le client');
  await owner.getByRole('button', { name: 'Livraison échouée' }).click();
  await expect(owner.locator('.admin-head .pill').first()).toHaveText('Livraison échouée');
  await expect(owner.getByText('Refusé par le client')).toBeVisible();
  await expect(owner.getByRole('button', { name: 'Annuler la commande' })).toHaveCount(0);

  await owner.goto('/admin/stock');
  const stockBefore = await owner.locator('main').innerText();
  await owner.goto(`/admin/orders/${id}`);
  await owner.getByRole('button', { name: 'Retournée à BOGA' }).click();
  await owner.getByRole('button', { name: /Confirmer le retour/ }).click();
  await expect(owner.locator('.admin-head .pill').first()).toHaveText('Retournée à BOGA');
  await owner.goto('/admin/stock');
  expect(await owner.locator('main').innerText()).toBe(stockBefore);

  await owner.goto('/admin');
  const failed = owner.locator('table', { has: owner.getByText('Refusé par le client') });
  await expect(failed).toBeVisible();
});
