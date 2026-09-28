import { validateBlend } from './blend';
import { roundKg, roundMoney } from './money';
import { customBlendPrice, productPrice } from './pricing';
import { composition, type OriginIndex } from './recipe';
import { findShortages, stockRequirements, type Shortage } from './stock';
import { PACK_SIZES, type CartItem, type Localized, type OrderLine, type Product, type Settings, type StockDeduction } from './types';

export interface Catalog {
  products: Product[];
  origins: OriginIndex;
}

export const CUSTOM_BLEND_NAME: Localized = {
  ar: 'خلطتي الخاصة',
  fr: 'Mon Custom Blend',
  en: 'My Custom Blend',
};

export type LineProblem = 'missing_product' | 'size_not_offered' | 'invalid_blend' | 'invalid_quantity';

/** Bags of one kind per line. Beyond this the order is a B2B quote anyway. */
export const MAX_QTY_PER_LINE = 100;

/** A quantity the cart can hold: a whole number of bags, 1 to MAX_QTY_PER_LINE. */
export const isValidQty = (qty: unknown): qty is number =>
  typeof qty === 'number' && Number.isInteger(qty) && qty >= 1 && qty <= MAX_QTY_PER_LINE;

/**
 * Shape check for items read back from storage (or, in production, sent by a
 * browser): anything else is dropped before it reaches pricing.
 */
export function isWellFormedItem(item: unknown): item is CartItem {
  if (!item || typeof item !== 'object') return false;
  const i = item as Record<string, unknown>;
  if (typeof i.id !== 'string' || !isValidQty(i.qty)) return false;
  if (i.type === 'product') return typeof i.productId === 'string' && PACK_SIZES.includes(i.size as never);
  if (i.type !== 'custom' || !i.blend || typeof i.blend !== 'object') return false;
  const b = i.blend as Record<string, unknown>;
  return (
    PACK_SIZES.includes(b.size as never) &&
    Array.isArray(b.lines) &&
    b.lines.every((l) => l && typeof l === 'object' && typeof (l as { originId?: unknown }).originId === 'string' && Number.isInteger((l as { percent?: unknown }).percent))
  );
}

/** Turns a cart item into a priced, frozen order line. */
export function resolveItem(
  item: CartItem,
  catalog: Catalog,
  settings: Settings,
): { line: OrderLine } | { problem: LineProblem } {
  // never trust a quantity or a size: prices, stock and the B2B rule all depend on them
  if (!isValidQty(item.qty)) return { problem: 'invalid_quantity' };
  if (item.type === 'product') {
    if (!PACK_SIZES.includes(item.size)) return { problem: 'size_not_offered' };
    const product = catalog.products.find((p) => p.id === item.productId && p.active);
    if (!product) return { problem: 'missing_product' };
    const unitPrice = productPrice(product, item.size);
    if (unitPrice === undefined) return { problem: 'size_not_offered' };
    return {
      line: {
        kind: 'product',
        productId: product.id,
        name: product.name,
        size: item.size,
        qty: item.qty,
        unitPrice,
        lineTotal: roundMoney(unitPrice * item.qty),
        composition: composition(product.recipe, item.size),
      },
    };
  }

  // Stock is checked for the whole cart together, not per line.
  if (!PACK_SIZES.includes(item.blend.size)) return { problem: 'size_not_offered' };
  if (!item.blend.lines.every((l) => Number.isInteger(l.percent))) return { problem: 'invalid_blend' };
  const rules = validateBlend(item.blend, catalog.origins, settings, 0).filter((i) => i.code !== 'stock');
  if (rules.length > 0 || !settings.customBlend.enabled) return { problem: 'invalid_blend' };
  const unitPrice = customBlendPrice(item.blend, catalog.origins, settings).total;
  return {
    line: {
      kind: 'custom',
      name: CUSTOM_BLEND_NAME,
      size: item.blend.size,
      qty: item.qty,
      unitPrice,
      lineTotal: roundMoney(unitPrice * item.qty),
      composition: composition(item.blend.lines, item.blend.size),
    },
  };
}

export interface CartSummary {
  lines: { item: CartItem; line?: OrderLine; problem?: LineProblem }[];
  subtotal: number;
  weightKg: number;
  /** true when the total weight goes above the B2B threshold (10 kg). */
  isB2B: boolean;
  requirements: StockDeduction[];
  shortages: Shortage[];
  hasProblems: boolean;
}

export function summarizeCart(items: CartItem[], catalog: Catalog, settings: Settings): CartSummary {
  const lines = items.map((item) => {
    const r = resolveItem(item, catalog, settings);
    return 'line' in r ? { item, line: r.line } : { item, problem: r.problem };
  });
  const valid = lines.flatMap((l) => (l.line ? [l.line] : []));
  const subtotal = roundMoney(valid.reduce((s, l) => s + l.lineTotal, 0));
  const weightKg = roundKg(valid.reduce((s, l) => s + (l.size / 1000) * l.qty, 0));
  const requirements = stockRequirements(
    valid.map((l) => ({
      recipe: l.composition.map(({ originId, percent }) => ({ originId, percent })),
      size: l.size,
      qty: l.qty,
    })),
    settings.roastLossPercent,
  );
  const shortages = findShortages(requirements, catalog.origins);
  return {
    lines,
    subtotal,
    weightKg,
    isB2B: weightKg > settings.b2bThresholdKg,
    requirements,
    shortages,
    hasProblems: lines.some((l) => l.problem) || shortages.length > 0,
  };
}
