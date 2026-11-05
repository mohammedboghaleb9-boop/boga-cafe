import { expect, test } from '@playwright/test';
import { open } from './helpers';

test.describe('admin panel that fails to load', () => {
  test('shows a message and a retry instead of a blank page; the shop is untouched', async ({ page }) => {
    // the panel's own file (loaded on demand) cannot be fetched: a lost connection, or an old tab after a deploy
    let blocked = true;
    let panelRequests = 0;
    await page.route('**/assets/AdminApp-*.js', (route) => {
      panelRequests += 1;
      return blocked ? route.abort() : route.continue();
    });

    await page.goto('/admin');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('n’a pas pu s’ouvrir');
    await expect(page.getByRole('alert')).toContainText('Vérifiez votre connexion');
    await expect(page.locator('#login-role')).toHaveCount(0);

    // the connection is back: the retry opens the panel
    blocked = false;
    await page.getByRole('button', { name: 'Réessayer' }).click();
    await expect(page.locator('#login-role')).toBeVisible();

    // the shop loads normally with the panel's file blocked again: no panel error screen, and the shop never asks for that file
    blocked = true;
    const before = panelRequests;
    expect(before, 'the route sees the panel file requests').toBeGreaterThan(0);
    await open(page, '/shop');
    await expect(page).toHaveURL(/\/shop$/);
    await expect(page.getByRole('link', { name: /BOGA Signature/ })).toHaveCount(1);
    await expect(page.getByRole('heading', { name: 'n’a pas pu s’ouvrir' })).toHaveCount(0);
    expect(panelRequests).toBe(before);
  });
});
