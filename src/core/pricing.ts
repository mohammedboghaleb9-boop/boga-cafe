import { roundMoney } from './money';
import type { OriginIndex } from './recipe';
import type { CustomBlendSpec, PackSize, Product, Settings } from './types';

/**
 * A real price: at least 1 DH. Totals are rounded to the whole dirham
 * (roundMoney), so anything below would sell a bag for 0 DH; 0, empty or a
 * typing mistake means "not offered". Also used for an origin's price per kg.
 */
export const isPrice = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 1;

/** The highest price the catalog saves (a bag, or an origin's kilo), in DH: anything above is a typing slip. */
export const MAX_PRICE = 100_000;

export const productPrice = (product: Product, size: PackSize): number | undefined => {
  const price = product.prices[size];
  return isPrice(price) ? price : undefined;
};

export const offeredSizes = (product: Product): PackSize[] =>
  ([250, 500, 1000] as PackSize[]).filter((s) => productPrice(product, s) !== undefined);

export const lowestPrice = (product: Product): number | undefined => {
  const values = offeredSizes(product).map((s) => productPrice(product, s)!);
  return values.length ? Math.min(...values) : undefined;
};

export interface BlendPriceBreakdown {
  lines: { originId: string; grams: number; cost: number }[];
  fee: number;
  total: number;
}

/**
 * Custom Blend price = Σ (origin price per kg × kg of that origin in the bag) + bag fee.
 * Computed live in the builder, and recomputed by the database (supabase check_order)
 * when the order is saved.
 */
export function customBlendPrice(
  spec: CustomBlendSpec,
  origins: OriginIndex,
  settings: Settings,
): BlendPriceBreakdown {
  const lines = spec.lines.map((l) => {
    const origin = origins[l.originId];
    const grams = (spec.size * l.percent) / 100;
    const cost = origin ? (origin.pricePerKg * grams) / 1000 : 0;
    return { originId: l.originId, grams, cost };
  });
  const fee = settings.customBlend.feeBySize[spec.size] ?? 0;
  const total = roundMoney(lines.reduce((s, l) => s + l.cost, 0) + fee);
  return { lines, fee, total };
}
