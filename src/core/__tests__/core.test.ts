import { describe, expect, it } from 'vitest';
import { balanceBlend, validateBlend } from '../blend';
import { summarizeCart } from '../cart';
import { buildOrder, validateCustomer } from '../order';
import { customBlendPrice } from '../pricing';
import { composition, speciesSplit } from '../recipe';
import { shippingFee } from '../shipping';
import { applyStock, findShortages, maxBags, stockRequirements } from '../stock';
import { normalizePhone } from '../validation';
import type { CartItem, CustomerInfo } from '../types';
import { origins, originIndex, product, rate, settings } from './fixtures';

const catalog = { products: [product], origins: originIndex };

describe('recipe', () => {
  it('derives Arabica / Robusta from the origins', () => {
    expect(speciesSplit(product.recipe, originIndex)).toEqual({ arabica: 80, robusta: 20 });
  });

  it('splits a 1 kg bag into grams (concept example: 50/30/20)', () => {
    const lines = [
      { originId: 'colombia', percent: 50 },
      { originId: 'brazil', percent: 30 },
      { originId: 'vietnam', percent: 20 },
    ];
    expect(composition(lines, 1000).map((c) => c.grams)).toEqual([500, 300, 200]);
  });
});

describe('custom blend', () => {
  const spec = {
    size: 1000 as const,
    lines: [
      { originId: 'brazil', percent: 50 },
      { originId: 'colombia', percent: 50 },
    ],
  };

  it('prices by ingredients, proportions and weight', () => {
    // 0.5 kg × 200 + 0.5 kg × 300 + 20 fee
    expect(customBlendPrice(spec, originIndex, settings).total).toBe(270);
    expect(customBlendPrice({ ...spec, size: 250 }, originIndex, settings).total).toBe(73);
  });

  it('rounds a half dirham up, as the database does, whatever binary fractions add up to', () => {
    // 1 kg: 810 g × 303 + 90 g × 483 + 50 g × 369 + 50 g × 443 DH/kg + 15 = 344.5 exactly
    const index = Object.fromEntries(
      [['a', 303], ['b', 483], ['c', 369], ['d', 443]].map(([id, pricePerKg]) => [id, { ...origins[0], id: id as string, pricePerKg: pricePerKg as number }]),
    );
    const lines = [{ originId: 'a', percent: 81 }, { originId: 'b', percent: 9 }, { originId: 'c', percent: 5 }, { originId: 'd', percent: 5 }];
    const fee = { ...settings, customBlend: { ...settings.customBlend, feeBySize: { 250: 0, 500: 0, 1000: 15 } } };
    expect(customBlendPrice({ size: 1000, lines }, index, fee).total).toBe(345);
  });

  it('accepts a valid recipe', () => {
    expect(validateBlend(spec, originIndex, settings)).toEqual([]);
  });

  it('requires exactly 100 %', () => {
    const issues = validateBlend(
      { ...spec, lines: [{ originId: 'brazil', percent: 60 }, { originId: 'colombia', percent: 30 }] },
      originIndex,
      settings,
    );
    expect(issues).toContainEqual({ code: 'total', total: 90 });
  });

  it('blocks origins disabled by the admin and shows the restock date', () => {
    const issues = validateBlend(
      { ...spec, lines: [{ originId: 'ethiopia', percent: 100 }] },
      originIndex,
      settings,
    );
    expect(issues).toContainEqual({ code: 'unavailable', originId: 'ethiopia', restockDate: '2026-11-01' });
  });

  it('blocks origins without enough stock', () => {
    // vietnam has 1 kg; 2 × 1 kg bags at 60 % need 1.2 kg
    const issues = validateBlend(
      { size: 1000, lines: [{ originId: 'vietnam', percent: 60 }, { originId: 'brazil', percent: 40 }] },
      originIndex,
      settings,
      2,
    );
    expect(issues.map((i) => i.code)).toContain('stock');
  });

  it('balances percentages to 100', () => {
    const balanced = balanceBlend([{ percent: 50 }, { percent: 30 }, { percent: 30 }]);
    expect(balanced.reduce((s, l) => s + l.percent, 0)).toBe(100);
    expect(balanceBlend([{ percent: 0 }, { percent: 0 }, { percent: 0 }]).map((l) => l.percent)).toEqual([33, 33, 34]);
  });
});

describe('stock', () => {
  it('deducts each origin from its own stock', () => {
    const req = stockRequirements([{ recipe: product.recipe, size: 1000, qty: 2 }], 0);
    expect(req).toEqual([
      { originId: 'brazil', kg: 1.6 },
      { originId: 'vietnam', kg: 0.4 },
    ]);
    const after = applyStock(origins, req, -1);
    expect(after.find((o) => o.id === 'brazil')!.stockKg).toBe(48.4);
    expect(applyStock(after, req, 1).find((o) => o.id === 'brazil')!.stockKg).toBe(50);
  });

  it('accounts for roasting loss when stock is green coffee', () => {
    const req = stockRequirements([{ recipe: [{ originId: 'brazil', percent: 100 }], size: 1000, qty: 1 }], 20);
    expect(req[0].kg).toBe(1.25);
  });

  it('rounds half a gram up, as the database does', () => {
    // 250 g × 4 % with 20 % roasting loss = 0.0125 kg exactly, 0.012499999… in binary
    const req = stockRequirements([{ recipe: [{ originId: 'brazil', percent: 96 }, { originId: 'colombia', percent: 4 }], size: 250, qty: 1 }], 20);
    expect(req).toEqual([{ originId: 'brazil', kg: 0.3 }, { originId: 'colombia', kg: 0.013 }]);
  });

  it('knows how many bags are left', () => {
    // vietnam 1 kg, 20 % of 1 kg = 0.2 kg per bag → 5 bags
    expect(maxBags(product.recipe, 1000, originIndex, 0)).toBe(5);
    expect(findShortages([{ originId: 'vietnam', kg: 1.2 }], originIndex)).toHaveLength(1);
  });
});

describe('cart and B2B rule', () => {
  it('stays B2C at exactly 10 kg and becomes B2B above', () => {
    const at10: CartItem[] = [{ id: 'a', type: 'product', productId: 'signature', size: 1000, qty: 10 }];
    const big = { ...catalog, origins: { ...originIndex, vietnam: { ...originIndex.vietnam, stockKg: 100 } } };
    expect(summarizeCart(at10, big, settings).isB2B).toBe(false);
    const above: CartItem[] = [...at10, { id: 'b', type: 'product', productId: 'signature', size: 250, qty: 1 }];
    expect(summarizeCart(above, big, settings).isB2B).toBe(true);
  });

  it('checks stock across all cart lines together', () => {
    const items: CartItem[] = [
      { id: 'a', type: 'product', productId: 'signature', size: 1000, qty: 3 }, // 0.6 kg vietnam
      {
        id: 'b',
        type: 'custom',
        qty: 1,
        blend: { size: 1000, lines: [{ originId: 'vietnam', percent: 50 }, { originId: 'brazil', percent: 50 }] },
      }, // +0.5 kg vietnam → 1.1 > 1
    ];
    const summary = summarizeCart(items, catalog, settings);
    expect(summary.shortages.map((s) => s.originId)).toEqual(['vietnam']);
  });

  it('refuses a size the product does not offer', () => {
    const summary = summarizeCart(
      [{ id: 'a', type: 'product', productId: 'signature', size: 500, qty: 1 }],
      catalog,
      settings,
    );
    expect(summary.lines[0].problem).toBe('size_not_offered');
  });
});

describe('shipping', () => {
  it('charges per city with an extra per started kg', () => {
    expect(shippingFee(rate, 1.5, 100, settings)).toBe(20);
    expect(shippingFee(rate, 2, 100, settings)).toBe(20);
    expect(shippingFee(rate, 3.25, 100, settings)).toBe(30);
    expect(shippingFee(rate, 3.25, 900, { freeShippingOver: 500 })).toBe(0);
  });

  it('rounds a half dirham up, as the database does', () => {
    // 10.10 + 6 extra kg × 16.40 = 108.5 exactly, 108.49999… in binary
    expect(shippingFee({ ...rate, baseFee: 10.1, includedKg: 3, extraPerKg: 16.4 }, 9, 100, { freeShippingOver: 0 })).toBe(109);
  });
});

describe('order', () => {
  const customer: CustomerInfo = {
    fullName: 'Yassine Test',
    phone: '06 12 34 56 78',
    email: '',
    cityId: 'oujda',
    address: 'Bd Mohammed V, Oujda',
    company: '',
    notes: '',
  };
  const ctx = {
    catalog,
    settings,
    shippingRates: [rate],
    paymentMethods: [
      { id: 'card' as const, enabled: true, label: product.name, instructions: product.name },
      { id: 'bank_transfer' as const, enabled: false, label: product.name, instructions: product.name },
    ],
  };
  const ids = { id: 'o1', number: 'BC-0001', now: '2026-09-27T10:00:00Z' };

  it('recomputes totals and stock deductions', () => {
    const r = buildOrder(
      { items: [{ id: 'a', type: 'product', productId: 'signature', size: 250, qty: 2 }], customer, paymentMethod: 'card', locale: 'fr' },
      ctx,
      ids,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.order.subtotal).toBe(120);
    expect(r.order.shippingFee).toBe(20);
    expect(r.order.total).toBe(140);
    expect(r.order.customer.phone).toBe('+212612345678');
    expect(r.order.stockDeductions).toEqual([
      { originId: 'brazil', kg: 0.4 },
      { originId: 'vietnam', kg: 0.1 },
    ]);
  });

  it('rejects disabled payment methods and bad customer data', () => {
    const r = buildOrder(
      {
        items: [{ id: 'a', type: 'product', productId: 'signature', size: 250, qty: 1 }],
        customer: { ...customer, phone: '123', cityId: 'nowhere' },
        paymentMethod: 'bank_transfer',
        locale: 'ar',
      },
      ctx,
      ids,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toEqual(expect.arrayContaining(['phone', 'city', 'payment_method']));
  });

  it('sends orders above 10 kg to the B2B process', () => {
    const big = { ...ctx, catalog: { ...catalog, origins: { ...originIndex, vietnam: { ...originIndex.vietnam, stockKg: 100 } } } };
    const r = buildOrder(
      { items: [{ id: 'a', type: 'product', productId: 'signature', size: 1000, qty: 11 }], customer, paymentMethod: 'card', locale: 'fr' },
      big,
      ids,
    );
    expect(r).toMatchObject({ ok: false, errors: expect.arrayContaining(['b2b_required']) });
  });
});

describe('customer', () => {
  const customer: CustomerInfo = { fullName: 'Ali', phone: '0612345678', email: '', cityId: rate.id, address: '12 rue', company: '', notes: '' };
  it('counts characters as the database does, after trimming any white space', () => {
    expect(validateCustomer(customer, [rate])).toEqual([]);
    expect(validateCustomer({ ...customer, fullName: '\u00a0Ali\u3000', address: '\u200312 rue' }, [rate])).toEqual([]);
    expect(validateCustomer({ ...customer, fullName: '\u00a0Al\u3000', address: '12 ru' }, [rate])).toEqual(['name', 'address']);
    expect(validateCustomer({ ...customer, fullName: '😀😀' }, [rate])).toEqual(['name']); // two characters, not four
  });
});

describe('phone', () => {
  it('normalizes Moroccan numbers', () => {
    expect(normalizePhone('+212 6 61 00 00 00')).toBe('+212661000000');
    expect(normalizePhone('0712345678')).toBe('+212712345678');
    expect(normalizePhone('0812345678')).toBeNull();
  });
});
