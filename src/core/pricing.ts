import { roundMoney } from './money';
import type { OriginIndex } from './recipe';
import type { CustomBlendSpec, PackSize, Product, Settings } from './types';

export const productPrice = (product: Product, size: PackSize): number | undefined =>
  product.prices[size];

export const offeredSizes = (product: Product): PackSize[] =>
  ([250, 500, 1000] as PackSize[]).filter((s) => product.prices[s] !== undefined);

export const lowestPrice = (product: Product): number | undefined => {
  const values = Object.values(product.prices).filter((v): v is number => typeof v === 'number');
  return values.length ? Math.min(...values) : undefined;
};

export interface BlendPriceBreakdown {
  lines: { originId: string; grams: number; cost: number }[];
  fee: number;
  total: number;
}

/**
 * Custom Blend price = Σ (origin price per kg × kg of that origin in the bag) + bag fee.
 * Computed live in the builder and recomputed on the server when the order is placed.
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
