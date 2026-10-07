/**
 * Slice 3b (owner, 2026-10-06): a product with an empty or switched-off origin is
 * unavailable, whatever the size; a cart holding it is sent neither as an order
 * nor as a B2B request, and the refusal says so ('unavailable', not 'out_of_stock').
 */
import { describe, expect, it } from 'vitest';
import { summarizeCart } from '../cart';
import { buildOrder } from '../order';
import { buildQuoteRequest } from '../requests';
import { isProductAvailable } from '../stock';
import type { CartItem, Product } from '../types';
import { origin, originIndex, product, rate, settings } from './fixtures';

// ethiopia has 0 kg (fixtures)
const single = (id: string, originId: string): Product => ({ ...product, id, slug: id, kind: 'single-origin', recipe: [{ originId, percent: 100 }] });
const sidamo = single('so-ethiopia', 'ethiopia');
const catalog = { products: [product, sidamo], origins: originIndex };
const cart: CartItem[] = [
  { id: 'a', type: 'product', productId: 'signature', size: 250, qty: 1 },
  { id: 'b', type: 'product', productId: 'so-ethiopia', size: 250, qty: 1 },
];
const customer = { fullName: 'Yassine Test', phone: '0612345678', email: '', cityId: 'oujda', address: 'Bd Mohammed V, Oujda', company: '', notes: '' };
const methods = [{ id: 'bank_transfer' as const, enabled: true, label: product.name, instructions: product.name }];

describe('unavailable products', () => {
  it('is unavailable when one origin is empty, switched off or unknown to the visitor', () => {
    expect(isProductAvailable(product.recipe, originIndex)).toBe(true);
    expect(isProductAvailable(product.recipe, { ...originIndex, vietnam: origin('vietnam', { stockKg: 0.01 }) })).toBe(true);
    expect(isProductAvailable(product.recipe, { ...originIndex, vietnam: origin('vietnam', { stockKg: 0 }) })).toBe(false);
    expect(isProductAvailable(product.recipe, { ...originIndex, brazil: origin('brazil', { active: false }) })).toBe(false);
    expect(isProductAvailable(product.recipe, { brazil: originIndex.brazil })).toBe(false);
    expect(isProductAvailable([], originIndex)).toBe(false);
  });

  it('shows the line with its name but neither prices, weighs nor counts it against the stock', () => {
    const s = summarizeCart(cart, catalog, settings);
    expect(s.lines.map((l) => [l.problem, l.line?.productId])).toEqual([
      [undefined, 'signature'],
      ['unavailable', 'so-ethiopia'],
    ]);
    expect([s.subtotal, s.weightKg, s.shortages, s.hasProblems]).toEqual([60, 0.25, [], true]);
  });

  it('refuses the order with "unavailable" only, and keeps the line out of a B2B request', () => {
    const r = buildOrder({ items: cart, customer, paymentMethod: 'bank_transfer', locale: 'fr' }, { catalog, settings, shippingRates: [rate], paymentMethods: methods }, { id: 'o', number: 'n', now: '' });
    expect(r).toEqual({ ok: false, errors: ['unavailable'] });
    const q = buildQuoteRequest({ ...customer, businessType: 'cafe', contactName: 'Yassine Test', items: cart }, { catalog, settings, shippingRates: [rate] }, { id: 'q', number: 'n', now: '' });
    expect(q.ok && q.quote.lines.map((l) => l.productId)).toEqual(['signature']);
  });

  it('says "unavailable" for a B2B blend\'s 1 kg bag too, not "bulk only"', () => {
    const horeca: Product = { ...sidamo, id: 'horeca', kind: 'b2b', prices: { 1000: 150 } };
    const s = summarizeCart([{ id: 'a', type: 'product', productId: 'horeca', size: 1000, qty: 1 }], { ...catalog, products: [horeca] }, settings);
    expect(s.lines[0].problem).toBe('unavailable');
  });
});
