/** Formatting shared by the website, the admin and the notifications. */
export const formatNumber = (n: number, maxDecimals = 0) =>
  new Intl.NumberFormat('fr-FR', { maximumFractionDigits: maxDecimals }).format(n);

/**
 * "500 g" / "1 kg" are wrapped in invisible Unicode direction isolates
 * (LRI … PDI) so they never flip to "g 500" inside Arabic text.
 */
const ltr = (s: string) => `⁦${s}⁩`;

export const formatKg = (kg: number) => ltr(`${formatNumber(kg, 2)} kg`);

export const formatSize = (grams: number) => ltr(grams >= 1000 ? `${grams / 1000} kg` : `${grams} g`);
