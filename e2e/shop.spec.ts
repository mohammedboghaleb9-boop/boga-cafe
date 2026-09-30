import { expect, test } from '@playwright/test';
import { addSignatureBag, fillCheckout, signIn, watchErrors } from './helpers';

test.describe('customer', () => {
  test('orders by bank transfer, then reports the payment', async ({ page }) => {
    const errors = watchErrors(page);
    await addSignatureBag(page);
    await fillCheckout(page, 'bank_transfer');
    await expect(page.locator('h1')).toContainText('Client');
    // the message the customer sends to BOGA carries the delivery address
    const order = decodeURIComponent((await page.locator('.handoff-wa').getAttribute('href')) ?? '');
    expect(order).toContain('Adresse : 12 rue Test');
    await page.fill('#pay-ref', 'CP-778812');
    await page.locator('form.report button[type=submit]').click();
    // the card switches to the payment report once the order is updated
    const message = async () => decodeURIComponent((await page.locator('.handoff-wa').getAttribute('href')) ?? '');
    await expect.poll(message).toMatch(/Paiement signalé BC-/);
    expect(await message()).toContain('CP-778812');
    errors.check();
  });

  test('a reported payment is only a claim: staff cannot cancel it, the owner checks it, the customer can send it again', async ({ page, context }) => {
    await addSignatureBag(page);
    await fillCheckout(page, 'bank_transfer');
    const orderUrl = page.url();
    const id = orderUrl.split('/order/')[1];
    await page.fill('#pay-ref', 'CP-1');
    await page.locator('form.report button[type=submit]').click();
    await expect(page.locator('form.report')).toHaveCount(0);

    // each tab has its own admin session (sessionStorage), the data is shared
    const staff = await context.newPage();
    await signIn(staff, 'staff');
    await staff.goto(`/admin/orders/${id}`);
    await expect(staff.getByText(/seul le propriétaire annule/)).toBeVisible();
    await expect(staff.getByRole('button', { name: 'Annuler la commande' })).toHaveCount(0);

    const owner = await context.newPage();
    await signIn(owner, 'owner');
    await owner.goto(`/admin/orders/${id}`);
    await owner.getByRole('button', { name: 'Marquer échoué' }).click();

    await page.goto(orderUrl);
    await expect(page.getByText(/Nous n’avons pas trouvé ce paiement/)).toBeVisible();
    await page.fill('#pay-ref', 'CP-2');
    await page.locator('form.report button[type=submit]').click();
    await expect(page.locator('form.report')).toHaveCount(0);
  });

  test('cannot pay by card while no gateway is connected', async ({ page }) => {
    await addSignatureBag(page);
    await page.goto('/checkout');
    await expect(page.locator('input[value=card]')).toBeDisabled();
  });

  test('a cart over 10 kg goes to the B2B quote', async ({ page }) => {
    await addSignatureBag(page);
    await page.goto('/product/boga-signature');
    // 1 kg bag: add until the cart is over the 10 kg limit
    await page.locator('.seg button', { hasText: /1 kg/ }).first().click();
    for (let i = 0; i < 11; i++) await page.getByRole('button', { name: /Ajouter au panier/ }).click();
    await page.goto('/cart');
    await expect(page.getByRole('heading', { name: /10 kg/ })).toBeVisible();
  });

  test('a custom blend of two origins goes to the cart', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('/custom-blend');
    const tiles = page.locator('button.origin-tile:not([disabled])');
    await tiles.nth(0).click();
    await tiles.nth(1).click();
    const add = page.locator('button.btn-primary.btn-block');
    await expect(add).toBeEnabled();
    await add.click();
    await page.goto('/cart');
    await expect(page.locator('main')).toContainText('Custom Blend');
    errors.check();
  });

});

test.describe('Arabic', () => {
  test.use({ locale: 'ar-MA' });
  test('pages are right-to-left, and an unknown order still has a heading', async ({ page }) => {
    await page.goto('/order/unknown');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('h1')).toHaveCount(1);
  });
});
