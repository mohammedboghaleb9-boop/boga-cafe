import { expect, test } from '@playwright/test';
import { open, signIn, watchErrors } from './helpers';

test.describe('admin', () => {
  test('staff cannot open payments; the "to verify" tile shows them the orders instead', async ({ page }) => {
    await signIn(page, 'staff');
    await open(page, '/admin/payments');
    await expect(page.locator('main')).toContainText(/accès|access|صلاحية/i);
    await open(page, '/admin');
    const tile = page.locator('a.kpi[href*="view=verify"]');
    await expect(tile).toHaveCount(1);
    await tile.click();
    await expect(page).toHaveURL(/\/admin\/orders\?view=verify/);
    await expect(page.getByRole('tab', { selected: true })).toContainText('à vérifier');
    // the menu link goes back to all orders
    await page.locator('.admin-nav a[href="/admin/orders"]').click();
    await expect(page.getByRole('tab', { selected: true })).toContainText('Tout');
  });

  test('an odd ?view= value shows all orders', async ({ page }) => {
    await signIn(page, 'owner');
    for (const view of ['__proto__', 'toString', 'hasOwnProperty', 'bogus']) {
      await open(page, `/admin/orders?view=${view}`);
      await expect(page.getByRole('tab', { selected: true }), view).toContainText('Tout');
      await expect(page.locator('tbody tr').first(), view).toBeVisible();
    }
  });

  test('the owner\'s "to verify" tile opens payments', async ({ page }) => {
    await signIn(page, 'owner');
    await open(page, '/admin');
    await expect(page.locator('a.kpi[href="/admin/payments"]')).toHaveCount(1);
  });

  test('an order row opens with the keyboard', async ({ page }) => {
    const errors = watchErrors(page);
    await signIn(page, 'owner');
    await open(page, '/admin/orders');
    const link = page.locator('tbody .row-link').first();
    await link.focus();
    await expect(link).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/admin\/orders\/[^/?]+$/);
    await expect(page.locator('h1.num')).toBeVisible();
    // one history entry: Back returns to the list
    await page.goBack();
    await expect(page).toHaveURL(/\/admin\/orders$/);
    errors.check();
  });

  test('a mouse click anywhere on a product row opens the editor', async ({ page }) => {
    await signIn(page, 'owner');
    await open(page, '/admin/products');
    await page.locator('tbody tr.clickable td:nth-child(3)').first().click();
    await expect(page).toHaveURL(/\/admin\/products\/[^/]+$/);
  });

  test('saving with the keyboard keeps focus on the button (keyboard and screen-reader users keep their place)', async ({ page }) => {
    await signIn(page, 'owner');
    await open(page, '/admin/settings');
    const save = page.locator('.admin-head').getByRole('button', { name: 'Enregistrer' });
    await save.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.admin-head')).toContainText('Enregistré');
    await expect(save).toBeFocused();
  });
});
