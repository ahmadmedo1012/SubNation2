// R137 (FE decomposition): extracted verbatim from pages/admin/coupons.tsx —
// the money-discount module's pure metadata moved to its own React-free
// module so the page file shrinks to orchestration. The page (and the
// extracts) import these by name — every interface and constant is
// byte-identical; ZERO behavior change. The create/toggle/archive
// handlers that CONSUME the 10,000 LYD bound stay in the page (the
// money-discount POST/PATCH/DELETE fire only through page-owned
// handlers).

export interface Coupon {
  id: number;
  code: string;
  type: "percentage" | "fixed";
  value: number;
  min_order_amount: number;
  max_uses: number | null;
  used_count: number;
  expires_at: string | null;
  is_active: boolean;
  description: string | null;
  created_at: string;
}

export interface CreateForm {
  code: string;
  type: "percentage" | "fixed";
  value: string;
  min_order_amount: string;
  max_uses: string;
  expires_at: string;
  description: string;
}

export const EMPTY_FORM: CreateForm = {
  code: "",
  type: "percentage",
  value: "",
  min_order_amount: "",
  max_uses: "",
  expires_at: "",
  description: "",
};

// 110-M (109-m P3): client-side parity with the backend create route
// (backend/src/routes/coupons.ts) — percentage coupons are rejected at
// value >= 100 (r4 red-team F-3: a 100% coupon zeroes finalPrice and the
// checkout INVALID_PRICE gate fail-closes on every purchase), and ALL
// values are capped at 10,000 LYD (MAX_FIXED_COUPON_VALUE — a direct
// wallet-debit magnitude at checkout). Mirrored here so the form blocks
// submit with an inline Arabic error instead of surfacing the server's
// 400 after a round-trip.
export const MAX_FIXED_COUPON_VALUE = 10_000; // LYD — mirror of the backend bound

// ── R160 (the R158-A P3 «no sort affordance on coupons»): the ?sort=
// whitelist ──────────────────────────────────────────────────────────
// CLIENT-side by design (the users-directory precedent): GET /api/
// coupons/admin returns the ENTIRE capped list (≤200 rows) in one
// fetch, so the full dataset is in memory and a server-side sort param
// would be indirection with zero user value. Exactly the two columns
// worth ranking: created_at (الأحدث/الأقدم) and the discount value
// (الخصم — sorted by the raw numeric `value`, which is what the column
// RENDERS; the column mixes % and fixed LYD units, and the sort follows
// the displayed number honestly).
// The CouponsTable surface is a responsive DIV-GRID (the R-140-l
// frozen pin: no <table>/<th>/role=table retrofit — the stacked-card
// mobile layout owns that decision), so there is no th to carry
// aria-sort: the affordance rides the shared FilterTabs chips bar like
// the users directory's client-side sort (aria-pressed chips, one
// control for both breakpoints).
export const COUPON_SORTS = [
  "created_at:asc",
  "created_at:desc",
  "value:asc",
  "value:desc",
] as const;
export type CouponSort = (typeof COUPON_SORTS)[number];

/** Tolerant intake: an invalid ?sort= deep link degrades to the default
 * ordering ("" — the API's created_at DESC) instead of a 400. */
export const isCouponSort = (v: string): v is CouponSort =>
  (COUPON_SORTS as readonly string[]).includes(v);

// R160: the chip labels (the shared FilterTabs chips dialect — the
// users panel's «الأقدم» label precedent). The default maps to
// «الأحدث» because the API list is newest-first.
export const COUPON_SORT_CHIPS: Array<{ value: CouponSort; label: string }> = [
  { value: "created_at:desc", label: "الأحدث" },
  { value: "created_at:asc", label: "الأقدم" },
  { value: "value:desc", label: "الأعلى خصمًا" },
  { value: "value:asc", label: "الأقل خصمًا" },
];
