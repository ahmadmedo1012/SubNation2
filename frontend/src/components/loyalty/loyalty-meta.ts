// R137 (FE decomposition): extracted verbatim from pages/loyalty.tsx —
// the /api/loyalty response shapes and the payload guard. Pure types +
// a pure predicate: no React, no lucide, no fetches. The page's two
// queries and its render branch (`data && isLoyaltyPayload(data)`)
// import the SAME guard — the B4 P1-3 cross-page-cached-entry
// degradation contract stays one source.

export interface LoyaltyData {
  points: number;
  tier: string;
  lifetime_spend: number;
  referral_code: string;
  referral_link: string;
  referrals_total: number;
  referrals_credited: number;
  referrals_pending: number;
  points_value_lyd: string;
  next_tier: { tier: string; label: string; remaining: number } | null;
  // R115 (A8 #8 / A12): GET /api/loyalty has served tier_thresholds since
  // the round-94 contract regen — the page used to delete it from its
  // local interface and re-hardcode {500, 2000, 5000} for the progress
  // bar. Consumed now (fallback below only for a pre-R115 API shape).
  tier_thresholds?: { silver: number; gold: number; platinum: number };
  points_rate: { points_per_referral: number; points_per_lyd: number };
}

/** One points_ledger row as served by GET /api/loyalty/ledger (R115). */
export interface PointsLedgerEntry {
  id: number;
  type: string;
  type_label: string;
  points_delta: number;
  points_after: number;
  lyd_credited: number | null;
  created_at: string;
}

/** Payload shape guard (B4 P1-3): a 5xx {error} envelope or a malformed
 * 200 must never reach `data.points.toLocaleString()` — the queryFn
 * throws it into the error state, and the render branch below re-checks
 * so even a cross-page cached entry (referrals' queryFn has no guard)
 * degrades to the error card instead of the ErrorBoundary. */
export function isLoyaltyPayload(d: unknown): d is LoyaltyData {
  return (
    !!d &&
    typeof (d as LoyaltyData).points === "number" &&
    typeof (d as LoyaltyData).points_rate === "object" &&
    (d as LoyaltyData).points_rate !== null
  );
}
