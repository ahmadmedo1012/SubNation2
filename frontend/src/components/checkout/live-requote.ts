import type { LocalCartItem } from "@/lib/cart";
import type { Product } from "@workspace/api-client-react";

// R136 (FE-2 decomposition): extracted verbatim from pages/checkout.tsx —
// the 98-F2 live re-quote mapping of ONE cart line onto the live
// /api/products/:id payload. Pure function; ZERO React, zero behavior
// change (the mount-time re-quote effect in the page imports it by name
// — every variant/stock branch is byte-identical).

// ── 98-F2 (R98-A3 F5 / P2): live re-quote of ONE cart line ───────────────────
//
// Cart price snapshots are taken at add-to-cart time (lib/cart.tsx);
// between add and confirm a flash sale can end (or start, or an operator
// reprices). The re-quote maps a cart line onto the /api/products/:id
// payload's LIVE pricing for the line's selected variant (or the
// product-level display price for variant-less lines — the server
// charges legacy variant-less orders the CHEAPEST active variant, which
// is exactly what the payload's product-level price carries).

export type LiveLineResult =
  | {
      status: "priced";
      priceLYD: number;
      salePriceLYD: number | null;
      discountPercent: number | null;
      effectiveUnitPrice: number;
      /** R129-A1 (F1 wiring — B-11): the live row's stock rides the quote
       * so the re-quote refreshes the line's snapshot alongside price. */
      stockCount: number;
    }
  | { status: "unavailable" };

export function quoteLineFromProduct(live: Product, line: LocalCartItem): LiveLineResult {
  // The line's selected option must still exist as an ACTIVE variant —
  // a foreign/inactive/deleted variant id fails CLOSED server-side
  // (checkout.service VARIANT_NOT_FOUND: "never silently ignored: the
  // client would be charged a price it never displayed").
  const variant =
    line.variantId != null ? (live.variants ?? []).find((v) => v.id === line.variantId) : undefined;
  if (line.variantId != null && !variant) return { status: "unavailable" };
  // R130 (A1-F1): a DRAINED variant is the same dead end one level down.
  // The snapshot below is the product-wide total — other variants holding
  // stock made the line read "in stock" while the buyer's own variant had
  // a provably empty claim pool (scoped 0 + no generic units), so the
  // charge could only 409. A drained variant quotes with stock 0: the
  // existing B-11 machinery flags «نفد المخزون» and blocks the CTA —
  // the verdict the feature promised, now variant-honest. The price legs
  // still quote from the variant (an honest label for a blocked line).
  const priceLYD = variant ? variant.price : live.price;
  const salePriceLYD = variant ? (variant.sale_price ?? null) : (live.sale_price ?? null);
  const discountPercent = variant
    ? (variant.discount_percent ?? null)
    : (live.discount_percent ?? null);
  return {
    status: "priced",
    priceLYD,
    salePriceLYD,
    discountPercent,
    effectiveUnitPrice: salePriceLYD ?? priceLYD,
    // B-11 wiring: the live catalog row's stock — the same signal the
    // PDP renders (variants carry no stock of their own). A drained
    // variant overrides it with 0 (see above).
    stockCount: variant && variant.is_available === false ? 0 : live.stock_count,
  };
}
