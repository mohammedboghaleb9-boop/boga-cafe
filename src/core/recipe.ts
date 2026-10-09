import type { Origin, PackSize, RecipeLine } from './types';

export type OriginIndex = Record<string, Origin>;

export const indexOrigins = (origins: Origin[]): OriginIndex =>
  Object.fromEntries(origins.map((o) => [o.id, o]));

export const recipeTotal = (lines: RecipeLine[]): number =>
  lines.reduce((sum, l) => sum + l.percent, 0);

/** At most this many origins in a product's recipe. */
export const MAX_RECIPE_LINES = 8;

/** A product's recipe as the database saves it (save_product): 1 to 8 different known origins, whole percentages adding up to 100. */
export const isProductRecipe = (lines: RecipeLine[], origins: OriginIndex): boolean =>
  lines.length >= 1 &&
  lines.length <= MAX_RECIPE_LINES &&
  lines.every((l) => origins[l.originId] && Number.isInteger(l.percent) && l.percent >= 1 && l.percent <= 100) &&
  new Set(lines.map((l) => l.originId)).size === lines.length &&
  recipeTotal(lines) === 100;

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
