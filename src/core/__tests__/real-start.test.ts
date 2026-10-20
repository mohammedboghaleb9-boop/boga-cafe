/**
 * Slice 12, the owner's decisions of 2026-10-16: nothing is sold before the owner opens the
 * sales, an origin may have no price yet (and is then never shown), and a city's delivery fee
 * may have a cap. Owner, 2026-10-19: the included weight is 3 kg, not 4 (the 4th kg is the owner's own margin,
 * never a hidden charge): the customer pays what the same formula gives on the site, the server and the database.
 * The fees below show the formula; the real ones are entered when the tariff is ready (until then cities are hidden at 0).
 */
import { describe, expect, it } from 'vitest';
import { shippingRateOk } from '../config';
import { buildOrder, type CheckoutContext } from '../order';
import { originPriceOk } from '../pricing';
import { buildQuoteRequest } from '../requests';
import { shippingFee } from '../shipping';
import type { ShippingRate } from '../types';
import { originIndex, product, rate, settings } from './fixtures';

/** A tariff of that shape: 20 up to 3 kg, + 10 for the first started kg above 3, never above 30. */
const ownerTariff: ShippingRate = { ...rate, baseFee: 20, includedKg: 3, extraPerKg: 10, maxFee: 30 };

describe('delivery cap', () => {
  it.each([
    [0.25, 20],
    [3, 20], // 3 kg included
    [3.001, 30], // the 4th kg is charged: no hidden free kilo
    [4, 30],
    [10, 30],
    [25, 30], // a B2B weight: no upper limit on the 30 DH
  ])('the owner tariff: %s kg cost %s DH', (kg, fee) => {
    expect(shippingFee(ownerTariff, kg, 0, settings)).toBe(fee);
  });

  it('without a cap the fee keeps growing per started kg, as before', () => {
    const { maxFee: _, ...uncapped } = ownerTariff;
    expect(shippingFee(uncapped, 6, 0, settings)).toBe(50); // 20 + 3 started kg above 3 × 10
  });

  it('a cap below the base fee, or above 1000 DH, is not saved', () => {
    expect(shippingRateOk(ownerTariff)).toBe(true);
    expect(shippingRateOk({ ...ownerTariff, maxFee: 19 })).toBe(false);
    expect(shippingRateOk({ ...ownerTariff, maxFee: 1001 })).toBe(false);
    expect(shippingRateOk({ ...ownerTariff, maxFee: Number.NaN })).toBe(false);
    // the real start's placeholder (fees 0, hidden) is valid; shown, a base of 0 would be free delivery
    const unpriced = { ...ownerTariff, baseFee: 0, extraPerKg: 0, maxFee: undefined };
    expect(shippingRateOk({ ...unpriced, active: false })).toBe(true);
    expect(shippingRateOk({ ...unpriced, active: true })).toBe(false);
    expect(shippingRateOk({ ...unpriced, active: true, extraPerKg: 10 })).toBe(false); // free up to the included kg
    expect(shippingRateOk({ ...unpriced, active: true, maxFee: 0 })).toBe(false);
    expect(shippingRateOk({ ...unpriced, active: true, baseFee: 0.004 })).toBe(false); // stored as 0.00
    expect(shippingRateOk({ ...unpriced, active: true, baseFee: 20 })).toBe(true);
    expect(shippingRateOk({ ...ownerTariff, maxFee: 30.5 })).toBe(false); // whole DH: 30.5 would be charged 31
  });
});

describe('an origin without a price', () => {
  it('is saved hidden, never shown', () => {
    expect(originPriceOk({ pricePerKg: null, active: false })).toBe(true);
    expect(originPriceOk({ pricePerKg: null, active: true })).toBe(false);
    expect(originPriceOk({ pricePerKg: 0, active: false })).toBe(false); // 0 is not "no price": a made-up price is refused
    expect(originPriceOk({ pricePerKg: 220, active: true })).toBe(true);
  });
});

describe('sales gate', () => {
  const customer = { fullName: 'Salma Bennani', phone: '0612345678', email: '', cityId: rate.id, address: '12 rue Test', company: '', notes: '' };
  const ctx: CheckoutContext = {
    catalog: { products: [product], origins: originIndex },
    settings,
    shippingRates: [rate],
    paymentMethods: [{ id: 'card', enabled: true, label: product.name, instructions: product.name }],
  };
  const ids = { id: 'o1', number: 'BC-0001', now: '2026-10-16T10:00:00Z' };
  const order = { items: [{ id: 'a', type: 'product' as const, productId: 'signature', size: 250 as const, qty: 1 }], customer, paymentMethod: 'card' as const, locale: 'fr' as const };
  const quote = { businessType: 'cafe' as const, company: '', contactName: 'Amine Test', phone: '0612345678', email: '', cityId: rate.id, notes: '', items: order.items };

  it('closed: no order and no B2B request, whatever else is right', () => {
    const closed = { ...ctx, settings: { ...settings, salesOpen: false } };
    expect(buildOrder(order, closed, ids)).toEqual({ ok: false, errors: ['sales_closed'] });
    expect(buildQuoteRequest(quote, closed, ids)).toEqual({ ok: false, errors: ['sales_closed'] });
  });

  it('open: the same order and request go through', () => {
    expect(buildOrder(order, ctx, ids).ok).toBe(true);
    expect(buildQuoteRequest(quote, ctx, ids).ok).toBe(true);
  });
});
