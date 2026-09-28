import { recipeTotal, type OriginIndex } from './recipe';
import { findShortages, stockRequirements } from './stock';
import type { CustomBlendSpec, Settings } from './types';

export type BlendIssue =
  | { code: 'empty' }
  | { code: 'total'; total: number }
  | { code: 'min_percent'; originId: string; min: number }
  | { code: 'too_many'; max: number }
  | { code: 'duplicate'; originId: string }
  | { code: 'unavailable'; originId: string; restockDate?: string }
  | { code: 'stock'; originId: string; restockDate?: string };

/** Every rule a Custom Blend must respect before it can go into the cart. */
export function validateBlend(
  spec: CustomBlendSpec,
  origins: OriginIndex,
  settings: Settings,
  qty = 1,
): BlendIssue[] {
  const issues: BlendIssue[] = [];
  const { minPercent, maxOrigins } = settings.customBlend;

  if (spec.lines.length === 0) return [{ code: 'empty' }];
  if (spec.lines.length > maxOrigins) issues.push({ code: 'too_many', max: maxOrigins });

  const seen = new Set<string>();
  for (const line of spec.lines) {
    if (seen.has(line.originId)) issues.push({ code: 'duplicate', originId: line.originId });
    seen.add(line.originId);

    const origin = origins[line.originId];
    if (!origin || !origin.active || !origin.customBlendEnabled) {
      issues.push({ code: 'unavailable', originId: line.originId, restockDate: origin?.restockDate });
    }
    if (line.percent < minPercent) {
      issues.push({ code: 'min_percent', originId: line.originId, min: minPercent });
    }
  }

  const total = recipeTotal(spec.lines);
  if (total !== 100) issues.push({ code: 'total', total });

  const unavailable = new Set(
    issues.flatMap((i) => (i.code === 'unavailable' ? [i.originId] : [])),
  );
  const req = stockRequirements([{ recipe: spec.lines, size: spec.size, qty }], settings.roastLossPercent);
  for (const s of findShortages(req, origins)) {
    if (!unavailable.has(s.originId)) {
      issues.push({ code: 'stock', originId: s.originId, restockDate: s.restockDate });
    }
  }
  return issues;
}

/**
 * Spreads the percentages so the recipe reaches exactly 100 %, keeping every
 * line at `minPercent` or more (when that is possible at all).
 * Whole numbers only: the rounding difference goes to the biggest line.
 */
export function balanceBlend<T extends { percent: number }>(lines: T[], minPercent = 0): T[] {
  const n = lines.length;
  if (n === 0) return lines;
  const min = n * minPercent <= 100 ? Math.max(0, minPercent) : 0;
  const raw = lines.map((l) => Math.max(0, l.percent));
  const weights = raw.some((w) => w > 0) ? raw : raw.map(() => 1); // all at 0: split evenly

  // a line that would fall under the minimum is pinned to it, the others share the rest
  const pinned = new Set<number>();
  let shares: number[];
  for (;;) {
    const free = weights.map((_, i) => i).filter((i) => !pinned.has(i));
    const left = 100 - pinned.size * min;
    const freeWeight = free.reduce((sum, i) => sum + weights[i], 0);
    shares = weights.map((w, i) => (pinned.has(i) ? min : freeWeight > 0 ? (left * w) / freeWeight : left / free.length));
    const under = free.filter((i) => shares[i] < min);
    if (under.length === 0) break;
    under.forEach((i) => pinned.add(i));
  }

  // whole numbers; a share at or above the (whole) minimum never rounds below it
  const result = shares.map((x) => Math.round(x));
  let biggest = 0;
  result.forEach((p, i) => {
    if (p >= result[biggest]) biggest = i;
  });
  result[biggest] += 100 - result.reduce((sum, p) => sum + p, 0);
  return lines.map((l, i) => ({ ...l, percent: result[i] }));
}
