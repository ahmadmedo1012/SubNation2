// R137 (FE decomposition): extracted verbatim from pages/admin/referrals.tsx —
// the referral module's pure metadata moved to its own React-free module
// so the page file shrinks to orchestration. The page (and the extracts)
// import these by name — the type aliases, the 401 predicate, the status
// filter list, the medal trio and the server-cap mirror are
// byte-identical; ZERO behavior change. The credit POST (and its
// idempotency key + confirm gate) stays in the page — nothing here
// performs IO.

import type {
  AdminReferralEventRow,
  AdminReferralsStats,
  AdminTopReferrer,
} from "@workspace/api-client-react";

// R127-L1: the hand-rolled row interface is the generated
// AdminReferralEventRow (field-identical — the batch-1 contract row
// pins the shape); aliased so the render code keeps its local name.
// (The old ReferralData/TopReferrer interfaces had no remaining
// references once the list rode useListAdminReferrals — deleted.)
export type ReferralRow = AdminReferralEventRow;
// Re-exported so the extracts never import the generated package
// directly (their only dependency is this module — the render suites'
// vi.mock boundaries on @workspace/api-client-react stay page-only).
export type { AdminReferralsStats, AdminTopReferrer };

/** R127-L1 (B1 §3.3): a 401 from the generated fetcher is the global
 * admin-session handler's business (toast + redirect fired inside
 * customFetch) — the error card + the credit catch below stay quiet on
 * it. ApiError is type-only from the package, so the check duck-types
 * `status` (the alerts.tsx R126-L8b idiom). */
export function isSessionExpiredError(err: unknown): boolean {
  return (err as { status?: unknown } | null | undefined)?.status === 401;
}

export const STATUS_FILTERS = [
  { value: "", label: "الكل" },
  { value: "credited", label: "ناجحة" },
  { value: "pending", label: "معلقة" },
];

export const MEDAL_COLORS = [
  // R128 (A1-D10/F3): the medal trio rides the NEW theme-aware --tier-*
  // inks. Gold was already the --status-warning pair (R126-L5 —
  // yellow-400 text failed the light theme 1.43:1); silver (slate-400)
  // and bronze (amber-600) measured 2.56:1 / 3.19:1 in light — the
  // tier tokens are AA in both themes by construction (tier-gold =
  // var(--status-warning), so gold is visually unchanged).
  "text-tier-gold bg-tier-gold/10 border-tier-gold/20",
  "text-tier-silver bg-tier-silver/10 border-tier-silver/20",
  "text-tier-bronze bg-tier-bronze/10 border-tier-bronze/20",
];

/** R125-I3 (A2-5): the backend list route hardcodes LIMIT 200 with NO
 *  page param (routes/admin/referrals.ts) — the same frozen-cap contract
 *  as products/coupons. Mirror of the backend bound for the honest-cap
 *  footer wording (a backend change to that LIMIT is a contract change
 *  that must update this mirror — the products/coupons convention). */
export const REFERRALS_SERVER_CAP = 200;
