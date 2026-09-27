import { roundKg } from './money';
import type { OriginIndex } from './recipe';
import type { Origin, PackSize, RecipeLine, StockDeduction } from './types';

export interface Need {
  recipe: RecipeLine[];
  size: PackSize;
  qty: number;
}

/**
 * Kilograms of stock needed for one origin line.
 * `roastLossPercent` > 0 when stock is counted as green (unroasted) coffee.
 */
export const kgNeeded = (size: PackSize, percent: number, qty: number, roastLossPercent: number) =>
  ((size / 1000) * (percent / 100) * qty) / (1 - roastLossPercent / 100);

/** Adds up what a set of bags needs from each origin. */
export function stockRequirements(needs: Need[], roastLossPercent: number): StockDeduction[] {
  const totals = new Map<string, number>();
  for (const need of needs) {
    for (const line of need.recipe) {
      const kg = kgNeeded(need.size, line.percent, need.qty, roastLossPercent);
      totals.set(line.originId, (totals.get(line.originId) ?? 0) + kg);
    }
  }
  return [...totals].map(([originId, kg]) => ({ originId, kg: roundKg(kg) }));
}

export interface Shortage {
  originId: string;
  neededKg: number;
  availableKg: number;
  restockDate?: string;
}

/** Origins that cannot cover the requirement (inactive origins count as empty). */
export function findShortages(requirements: StockDeduction[], origins: OriginIndex): Shortage[] {
  const shortages: Shortage[] = [];
  for (const req of requirements) {
    const origin = origins[req.originId];
    const available = origin && origin.active ? origin.stockKg : 0;
    if (req.kg > available + 1e-9) {
      shortages.push({
        originId: req.originId,
        neededKg: req.kg,
        availableKg: available,
        restockDate: origin?.restockDate,
      });
    }
  }
  return shortages;
}

/** How many bags of this recipe/size the current stock can still produce. */
export function maxBags(
  recipe: RecipeLine[],
  size: PackSize,
  origins: OriginIndex,
  roastLossPercent: number,
): number {
  if (recipe.length === 0) return 0;
  let max = Infinity;
  for (const line of recipe) {
    const origin = origins[line.originId];
    if (!origin || !origin.active) return 0;
    const perBag = kgNeeded(size, line.percent, 1, roastLossPercent);
    if (perBag <= 0) continue;
    max = Math.min(max, Math.floor((origin.stockKg + 1e-9) / perBag));
  }
  return max === Infinity ? 0 : max;
}

/** Latest restock date among the origins that block a recipe. */
export function blockingRestockDate(shortages: Shortage[]): string | undefined {
  const dates = shortages.map((s) => s.restockDate).filter((d): d is string => Boolean(d));
  return dates.sort().at(-1);
}

/** sign = -1 removes stock (new order), +1 gives it back (cancelled order). */
export function applyStock(origins: Origin[], deductions: StockDeduction[], sign: 1 | -1): Origin[] {
  const byId = new Map(deductions.map((d) => [d.originId, d.kg]));
  return origins.map((o) =>
    byId.has(o.id) ? { ...o, stockKg: roundKg(o.stockKg + sign * byId.get(o.id)!) } : o,
  );
}

export const isLowStock = (origin: Origin) => origin.active && origin.stockKg <= origin.lowStockKg;
