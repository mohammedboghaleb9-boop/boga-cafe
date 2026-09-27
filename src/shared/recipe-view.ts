/** Helpers to show a recipe (flags, species split, origin names) in any section. */
import { speciesSplit, type OriginIndex } from '@/core/recipe';
import type { Localized, RecipeLine } from '@/core/types';

export function recipeView(recipe: RecipeLine[], origins: OriginIndex, l: (v: Localized) => string) {
  const split = speciesSplit(recipe, origins);
  const lines = recipe
    .filter((r) => origins[r.originId])
    .map((r) => ({ ...r, origin: origins[r.originId], name: l(origins[r.originId].name) }));
  return {
    split,
    lines,
    flags: lines.map((x) => ({ code: x.origin.countryCode, title: x.name })),
    splitShort: `${split.arabica}/${split.robusta} A/R`,
  };
}
