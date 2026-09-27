import type { Origin, PackSize, RecipeLine } from './types';

export type OriginIndex = Record<string, Origin>;

export const indexOrigins = (origins: Origin[]): OriginIndex =>
  Object.fromEntries(origins.map((o) => [o.id, o]));

export const recipeTotal = (lines: RecipeLine[]): number =>
  lines.reduce((sum, l) => sum + l.percent, 0);

/** Arabica / Robusta share of a recipe, derived from each origin's species. */
export function speciesSplit(lines: RecipeLine[], origins: OriginIndex) {
  let arabica = 0;
  let robusta = 0;
  for (const line of lines) {
    const origin = origins[line.originId];
    if (!origin) continue;
    if (origin.species === 'arabica') arabica += line.percent;
    else robusta += line.percent;
  }
  return { arabica, robusta };
}

/** Grams of each origin inside ONE bag of the given size. */
export const composition = (lines: RecipeLine[], size: PackSize) =>
  lines.map((l) => ({
    originId: l.originId,
    percent: l.percent,
    grams: Math.round(size * l.percent) / 100,
  }));
