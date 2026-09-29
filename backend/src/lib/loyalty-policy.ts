/**
 * Loyalty program policy — THE single source of truth (R115).
 *
 * Every consumer imports from here: routes/loyalty.ts, checkout.service,
 * refund.service, topup.service, admin/referrals.ts, admin/users.ts,
 * admin/pricing-calculator.ts, the OpenAPI descriptions and the tests.
 * Before R115 the constants lived in lib/loyalty-tiers.ts (tiers only) and
 * the welcome bonus was duplicated as bare literals in four services —
 * this module ends that.
 *
 * ── The policy (R115, modeled against the live catalog) ────────────────────
 *
 *   EARN        purchase award   = floor(final paid price) points
 *                                 (1 point per 1 LYD — coupons and flash
 *                                 sales reduce the paid price, so they
 *                                 reduce the award too; rounding DOWN is
 *                                 the house-favorable side)
 *   REDEEM      conversion       = POINTS_PER_LYD points → 1.00 LYD wallet
 *                                 credit (min one bundle, whole bundles
 *                                 only) → effective cashback = 1% of paid
 *   REFERRAL    referrer reward  = POINTS_PER_REFERRAL points (0.50 LYD)
 *                                 granted when the referee's FIRST topup is
 *                                 approved (manual approval = fraud gate)
 *   WELCOME     referred signup  = WELCOME_BONUS_LYD wallet credit granted
 *                                 with the same first-approved-topup event
 *                                 (all channels uniformly — R115 unified
 *                                 policy; previously Google/WhatsApp paid
 *                                 instantly and Telegram never paid, which
 *                                 was both a broken promise and a farming
 *                                 vector)
 *   TIERS       derived ONLY from net qualifying spend (lifetimeSpend =
 *                 completed payments − refunds); no manual override
 *   REFUND      reverses exactly the unrevoked remainder of THAT order's
 *                 PURCHASE_EARN award (via points_ledger), never points
 *                 from other sources; floored at zero — already-converted
 *                 value is not clawed back from the wallet (admin-gated
 *                 business cost, see docs/loyalty/FINAL_LOYALTY_POLICY.md)
 *
 * Economic model (live reconciliation 2026-09-29, 263 active variants):
 *   uniform 50% gross margin (markup 100% × rate 10) → full redemption
 *   liability = 1% of revenue ≈ 2% of gross profit. Worst case stack
 *   (10% active coupon) keeps every variant contribution-positive even
 *   with a referred first purchase (+5.50 LYD acquisition cost).
 */

export const POINTS_PER_LYD = 100;
export const POINTS_PER_REFERRAL = 50;
export const WELCOME_BONUS_LYD = 5.0;
export const TIER_THRESHOLDS = { silver: 500, gold: 2000, platinum: 5000 } as const;

export type LoyaltyTier = "bronze" | "silver" | "gold" | "platinum";

/** Purchase award: points earned for a completed purchase. Round DOWN. */
export function purchaseAwardPoints(finalPaidPrice: number): number {
  return Math.floor(finalPaidPrice);
}

/** Redemption: whole bundles of POINTS_PER_LYD only (enforced by the route). */
export function isConvertibleBundle(points: number): boolean {
  return points >= POINTS_PER_LYD && points % POINTS_PER_LYD === 0;
}

/** LYD wallet credit a bundle conversion yields (rate pinned in the ledger row). */
export function conversionCreditLyd(points: number): number {
  return +(points / POINTS_PER_LYD).toFixed(2);
}

/** Full-redemption LYD liability of a points balance (accounting view). */
export function pointsLiabilityLyd(points: number): number {
  return +(points / POINTS_PER_LYD).toFixed(4);
}

/** Total acquisition cost of one referred customer (welcome + referrer value). */
export function referralAcquisitionCostLyd(): number {
  return +(WELCOME_BONUS_LYD + POINTS_PER_REFERRAL / POINTS_PER_LYD).toFixed(4);
}

/**
 * Tier from net qualifying spend. Tiers are STRICTLY derived (R115): there
 * is no manual override — an admin edit would be silently clobbered by the
 * next purchase/refund (computeTier writers), which is exactly the
 * "unexplained tier/spend mismatch" the final policy forbids.
 */
export function computeTier(lifetimeSpend: number): LoyaltyTier {
  if (lifetimeSpend >= TIER_THRESHOLDS.platinum) return "platinum";
  if (lifetimeSpend >= TIER_THRESHOLDS.gold) return "gold";
  if (lifetimeSpend >= TIER_THRESHOLDS.silver) return "silver";
  return "bronze";
}

export function nextTier(
  lifetimeSpend: number,
): { tier: LoyaltyTier; label: string; remaining: number } | null {
  if (lifetimeSpend < TIER_THRESHOLDS.silver)
    return { tier: "silver", label: "فضي", remaining: TIER_THRESHOLDS.silver - lifetimeSpend };
  if (lifetimeSpend < TIER_THRESHOLDS.gold)
    return { tier: "gold", label: "ذهبي", remaining: TIER_THRESHOLDS.gold - lifetimeSpend };
  if (lifetimeSpend < TIER_THRESHOLDS.platinum)
    return {
      tier: "platinum",
      label: "بلاتيني",
      remaining: TIER_THRESHOLDS.platinum - lifetimeSpend,
    };
  return null;
}
