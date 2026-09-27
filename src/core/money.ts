/** All prices are in Moroccan dirham (MAD), rounded to the whole dirham. */
export const roundMoney = (value: number): number => Math.round(value);

/** Kilograms are kept with 3 decimals (= grams). */
export const roundKg = (value: number): number => Math.round(value * 1000) / 1000;
