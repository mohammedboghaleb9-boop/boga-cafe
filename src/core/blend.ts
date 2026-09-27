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
 * Spreads the remaining percentage so the recipe reaches exactly 100 %.
 * The last line absorbs rounding so the result is always a whole number.
 */
export function balanceBlend<T extends { percent: number }>(lines: T[]): T[] {
  if (lines.length === 0) return lines;
  const total = lines.reduce((sum, l) => sum + l.percent, 0);
  if (total === 0) {
    const even = Math.floor(100 / lines.length);
    return lines.map((l, i) => ({
      ...l,
      percent: i === lines.length - 1 ? 100 - even * (lines.length - 1) : even,
    }));
  }
  const scaled = lines.map((l) => ({ ...l, percent: Math.round((l.percent / total) * 100) }));
  const diff = 100 - scaled.reduce((s, l) => s + l.percent, 0);
  // give the rounding difference to the biggest line
  let biggest = 0;
  scaled.forEach((l, i) => {
    if (l.percent > scaled[biggest].percent) biggest = i;
  });
  scaled[biggest] = { ...scaled[biggest], percent: scaled[biggest].percent + diff };
  return scaled;
}
