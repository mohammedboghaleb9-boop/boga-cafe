import { roundMoney } from './money';
import type { Settings, ShippingRate } from './types';

/**
 * Delivery fee = city base fee (covers `includedKg`)
 *              + `extraPerKg` for every started kg above it,
 *              at most the city's `maxFee` (none: no cap).
 * The database computes the same (supabase check_order).
 * Free when the subtotal passes `freeShippingOver` (0 disables it).
 */
export function shippingFee(
  rate: ShippingRate,
  weightKg: number,
  subtotal: number,
  settings: Pick<Settings, 'freeShippingOver'>,
): number {
  if (settings.freeShippingOver > 0 && subtotal >= settings.freeShippingOver) return 0;
  const extraKg = Math.max(0, Math.ceil(weightKg - rate.includedKg - 1e-9));
  return roundMoney(Math.min(rate.baseFee + extraKg * rate.extraPerKg, rate.maxFee ?? Infinity));
}
