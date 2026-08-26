/**
 * Loyalty program constants + pure tier helpers.
 *
 * Single source of truth — routes/loyalty.ts, checkout.service,
 * topup.service and refund.service all import from here (services must not
 * reach into routes/ for shared logic).
 */

export const POINTS_PER_LYD = 100;
export const POINTS_PER_REFERRAL = 50;
export const TIER_THRESHOLDS = { silver: 500, gold: 2000, platinum: 5000 } as const;

export function computeTier(lifetimeSpend: number): string {
  if (lifetimeSpend >= TIER_THRESHOLDS.platinum) return "platinum";
  if (lifetimeSpend >= TIER_THRESHOLDS.gold) return "gold";
  if (lifetimeSpend >= TIER_THRESHOLDS.silver) return "silver";
  return "bronze";
}
