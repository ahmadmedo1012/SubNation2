// R137 (FE decomposition): extracted verbatim from pages/loyalty.tsx —
// the tier math as PURE functions (the R136 checkout pricing-helpers
// precedent). No React, no lucide: the page resolves the thresholds
// once from the API payload and passes the resolved map + the progress
// percent down to the extracts (StatsRow / HowToEarnCard) as values.
// Behavior is identical to the inline ladder it replaces — pinned at
// the rendered level by loyalty-history.test.tsx (the 60% bar and the
// 300/1500 threshold rows) and the 500/2000 fallback case.

// R115 (A8 #8): tier thresholds likewise derive from the API's
// tier_thresholds (fallback = the historical literals, pre-load only).
export const TIER_THRESHOLDS_FALLBACK: Record<string, number> = {
  silver: 500,
  gold: 2000,
  platinum: 5000,
};

/** The API's tier_thresholds, or the historical literals when the
 * payload omits them (the pre-R115 API shape). */
export function resolveTierThresholds(
  thresholds: { silver: number; gold: number; platinum: number } | undefined | null,
): Record<string, number> {
  return thresholds ?? TIER_THRESHOLDS_FALLBACK;
}

/** The tier progress bar's percent toward the next tier — clamped to
 * [2, 100] so a barely-started bar still reads as started and a
 * rounding overshoot can't overflow; 100 when there is no next tier
 * (platinum = the top). */
export function computeTierProgressPercent(
  nextTier: { tier: string; remaining: number } | null | undefined,
  tierThresholds: Record<string, number>,
): number {
  return nextTier
    ? Math.max(
        2,
        Math.min(100, 100 - (nextTier.remaining / (tierThresholds[nextTier.tier] ?? 1)) * 100),
      )
    : 100;
}
