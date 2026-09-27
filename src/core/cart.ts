import { validateBlend } from './blend';
import { roundKg, roundMoney } from './money';
import { customBlendPrice, productPrice } from './pricing';
import { composition, type OriginIndex } from './recipe';
import { findShortages, stockRequirements, type Shortage } from './stock';
import type { CartItem, Localized, OrderLine, Product, Settings, StockDeduction } from './types';

export interface Catalog {
  products: Product[];
  origins: OriginIndex;
}

export const CUSTOM_BLEND_NAME: Localized = {
  ar: 'خلطتي الخاصة',
  fr: 'Mon Custom Blend',
  en: 'My Custom Blend',
};

export type LineProblem = 'missing_product' | 'size_not_offered' | 'invalid_blend';

/** Turns a cart item into a priced, frozen order line. */
export function resolveItem(
  item: CartItem,
  catalog: Catalog,
  settings: Settings,
): { line: OrderLine } | { problem: LineProblem } {
  if (item.type === 'product') {
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
