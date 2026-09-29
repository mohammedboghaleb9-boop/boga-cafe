/**
 * All prices are in Moroccan dirham (MAD), rounded to the whole dirham.
 * A half goes up, as PostgreSQL round() does (supabase check_order): the tiny nudge
 * keeps 344.5, added up in binary as 344.49999…, from going down. Real amounts are
 * never within a billionth under a half, so nothing else moves.
 */
export const roundMoney = (value: number): number => Math.round(value + 1e-9);

/** Kilograms are kept with 3 decimals (= grams), half a gram up, like roundMoney. */
export const roundKg = (value: number): number => Math.round(value * 1000 + 1e-9) / 1000;
