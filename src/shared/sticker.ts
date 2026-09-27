/**
 * Text of the product sticker placed under the hexagon label on each pouch.
 * Packaging is printed in French whatever the language of the website,
 * so this is not translated. Pure function: same output on the site and in print files.
 */
import { formatSize } from '@/core/format';
import { speciesSplit, type OriginIndex } from '@/core/recipe';
import type { PackSize, RecipeLine, RoastLevel } from '@/core/types';

const ROAST_FR: Record<RoastLevel, string> = {
  light: 'CLAIRE',
  medium: 'MOYENNE',
  'medium-dark': 'MOYENNE-FONCÉE',
  dark: 'FONCÉE',
};

export interface StickerData {
  title: string;
  blend: string;
  flags: { code: string; title: string }[];
  detail: string;
  weight: string;
}

export function speciesLine(recipe: RecipeLine[], origins: OriginIndex): string {
  const { arabica, robusta } = speciesSplit(recipe, origins);
  if (robusta === 0) return '100% ARABICA';
  if (arabica === 0) return '100% ROBUSTA';
  return `${arabica}% ARABICA · ${robusta}% ROBUSTA`;
}

const flagsOf = (recipe: RecipeLine[], origins: OriginIndex) =>
  recipe
    .filter((l) => origins[l.originId])
    .map((l) => ({ code: origins[l.originId].countryCode, title: origins[l.originId].name.fr }));

export function productSticker(
  nameFr: string,
  recipe: RecipeLine[],
  roast: RoastLevel,
  size: PackSize,
  origins: OriginIndex,
): StickerData {
  return {
    title: nameFr.toLocaleUpperCase('fr-FR'),
    blend: speciesLine(recipe, origins),
    flags: flagsOf(recipe, origins),
    detail: `TORRÉFACTION : ${ROAST_FR[roast]}`,
    weight: `℮ ${formatSize(size)}`,
  };
}

/** Custom Blend: each origin keeps its reference roast, so the recipe is printed instead. */
export function customBlendSticker(recipe: RecipeLine[], size: PackSize, origins: OriginIndex): StickerData {
  return {
    title: 'CUSTOM BLEND',
    blend: speciesLine(recipe, origins),
    flags: flagsOf(recipe, origins),
    detail: `RECETTE : ${recipe.map((l) => l.percent).join(' / ')}`,
    weight: `℮ ${formatSize(size)}`,
  };
}
