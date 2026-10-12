import type { AdminOrder } from "@workspace/api-client-react";

// R137 (FE): extracted verbatim from pages/admin/orders.tsx — the page's
// shared row/credentials contracts (the r136 wallet idiom: the types the
// page AND its extracts both need live in the domain folder's React-free
// module). The move only changes the address; every docblock rides along.

/** API may return extra delivery / coupon fields */
export type AdminOrderRow = AdminOrder & {
  coupon_code?: string;
  discount_amount?: number;
  /** B6-03 (R116): the list no longer decrypts credentials — this flag
   *  is the availability signal; the plaintext comes from
   *  GET /api/admin/orders/:id/credentials on first reveal. */
  has_credentials?: boolean;
};

/** GET /api/admin/orders/:id/credentials response (B6-03). */
export interface OrderCredentials {
  id: number;
  order_code: string;
  status: string;
  has_credentials: boolean;
  delivered_email: string | null;
  delivered_password: string | null;
  delivered_extra_details: string | null;
  /** R117 (A1-P6): true when the raw columns are populated but every
   *  decrypt returned null — an ENCRYPTION_KEY mismatch, not "no
   *  data". The backend only emits it on that exact condition. */
  decrypt_failed?: boolean;
}

/** R137 (FE): the stats panel's top-coupon aggregate — the shape the
 *  page's coupon useMemo mints ({ code, uses, totalDiscount }). */
export interface TopCoupon {
  code: string;
  uses: number;
  totalDiscount: number;
}

/* ── R118-B2 (A6 F-8): memoized order rows ──────────────────────────────
 * The search box is a CONTROLLED input — every keystroke re-rendered the
 * whole page and (with rows inlined in the map closures) recomputed up to
 * 200 desktop <tr> subtrees + 200 mobile cards: ~400 row subtrees with
 * fresh inline handlers/className closures each keystroke (the network is
 * debounced at 300ms, but the RENDER path was not). The rows are now
 * module-level React.memo components whose props are stable across a
 * keystroke (order refs come from the memoized allOrders array;
 * isSelected/expanded/credsFailed are primitives; creds is the cached
 * per-order object; the two callbacks are useCallBack-stable) — so a
 * keystroke re-renders the search box and NOTHING else. Selection /
 * expansion flips bust exactly ONE row.
 *
 * Shared prop contract for both layouts. */
export interface OrderRowProps {
  order: AdminOrderRow;
  /** Position in `filtered` — drives the desktop zebra striping
   *  (idx % 2). Optional: the mobile card has no zebra. */
  idx?: number;
  isSelected: boolean;
  expanded: boolean;
  /** B6-03 (R116): cached per-order credentials payload (undefined until
   *  the first expansion's audited fetch resolves). */
  creds?: OrderCredentials;
  credsFailed: boolean;
  onToggleSelect: (id: number) => void;
  onToggleExpand: (id: number) => void;
}
