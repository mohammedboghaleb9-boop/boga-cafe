/**
 * Rules the post-merge audit found without a test: breaking any of them
 * must now fail here.
 */
import { describe, expect, it } from 'vitest';
import { validateBlend } from '../blend';
import { buildOrder } from '../order';
import { lowestPrice, offeredSizes, productPrice } from '../pricing';
import type { CartItem, CustomBlendSpec, CustomerInfo, Product } from '../types';
import { originIndex, product, rate, settings } from './fixtures';

const customer: CustomerInfo = {
  fullName: 'Yassine Test',
  phone: '06 12 34 56 78',
  email: '',
  cityId: 'oujda',
  address: 'Bd Mohammed V, Oujda',
  company: '',
  notes: '',
};
const ctx = (products: Product[] = [product]) => ({
  catalog: { products, origins: originIndex },
  settings,
  shippingRates: [rate],
  paymentMethods: [{ id: 'bank_transfer' as const, enabled: true, label: product.name, instructions: product.name }],
});
const ids = { id: 'o1', number: 'BC-2026-7K4M2Q', now: '2026-09-27T10:00:00Z' };
const order = (items: CartItem[], products?: Product[]) =>
  buildOrder({ items, customer, paymentMethod: 'bank_transfer', locale: 'fr' }, ctx(products), ids);
const bag = (qty: number, size: 250 | 500 | 1000 = 1000, productId = 'signature'): CartItem => ({ id: String(qty) + size, type: 'product', productId, size, qty });

describe('prices', () => {
  it('sell a size only at a real price: 0, negative or not a number is "not offered"', () => {
    const odd = { ...product, prices: { 250: 0, 500: -5, 1000: Number.NaN } } as Product;
    for (const s of [250, 500, 1000] as const) expect(productPrice(odd, s)).toBeUndefined();
    expect(offeredSizes(odd)).toEqual([]);
    expect(lowestPrice(odd)).toBeUndefined();
    const mixed = { ...product, prices: { 250: 0, 1000: 200 } };
    expect(offeredSizes(mixed)).toEqual([1000]);
    expect(lowestPrice(mixed)).toBe(200);
  });

  it('never let a free bag into an order', () => {
    const free = { ...product, prices: { 250: 0, 1000: 200 } };
    expect(order([bag(1, 250)], [free])).toEqual({ ok: false, errors: ['cart_problem'] });
    expect(order([bag(1, 1000)], [free]).ok).toBe(true);
  });
});

describe('stock', () => {
  it('refuses an order that needs more coffee than there is', () => {
    // Signature is 80 % Brazil / 20 % Vietnam, and there is only 1 kg of Vietnam
    expect(order([bag(1)]).ok).toBe(true);
    const r = order([bag(10)]);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors).toContain('out_of_stock');
  });
});

describe('custom blend', () => {
  it('refuses a coffee under the minimum share', () => {
    const spec: CustomBlendSpec = { size: 250, lines: [{ originId: 'brazil', percent: 97 }, { originId: 'colombia', percent: 3 }] };
    const issues = validateBlend(spec, originIndex, settings);
    expect(issues).toContainEqual({ code: 'min_percent', originId: 'colombia', min: settings.customBlend.minPercent });
    const ok: CustomBlendSpec = { ...spec, lines: [{ originId: 'brazil', percent: 95 }, { originId: 'colombia', percent: 5 }] };
    expect(validateBlend(ok, originIndex, settings).filter((i) => i.code === 'min_percent')).toEqual([]);
  });
});
