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
