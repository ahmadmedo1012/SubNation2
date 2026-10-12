import { roundToCents, type LocalCartItem } from "@/lib/cart";

// R136 (FE-2 decomposition): extracted verbatim from pages/checkout.tsx —
// the 98-F2 per-line coupon pre-flight (validation inputs + the
// per-unit-honest basket math). Pure functions + one fetch path; ZERO
// React, zero behavior change (applyCoupon and handleConfirm's pre-flight
// import them by name — every request and rounding step is
// byte-identical).

// ── 98-F2 (R98-A3 F1 / P1): per-line coupon validation ──────────────────────
//
// The pre-flight used to validate the coupon ONCE against the BASKET
// total while the backend applies it PER UNIT against each unit's
// basePrice (pricing.ts resolveCoupon + checkout.service computePricing
// per unit order; the unit loop below sends coupon_code on every unit):
//
//   • Scenario A — coupon min_order_amount between a line's unit price
//     and the basket total (e.g. min 30, unit 25, qty 3 → basket 75):
//     the basket-level pre-flight PASSED, then EVERY unit order failed
//     400 below_min_order — a guaranteed full failure after the UI had
//     just green-lit the checkout.
//   • Scenario B — fixed coupon with qty>1 (fixed 10, unit 25, qty 3):
//     the label showed discount 10 / total 65 while the server charged
//     3 × (25 − 10) = 45 (and consumed 3 redemption slots); the balance
//     gate compared the wrong number too.
//
// The pre-flight now validates per DISTINCT cart line, each with that
// line's UNIT price — the exact input the backend's per-unit pricing
// runs against — and the label/gate are computed from the per-unit
// finals exactly as the server charges them. The per-unit order POST
// loop semantics are untouched (the server stays authoritative and
// re-validates on every unit regardless).

export interface CouponQuoteLine {
  /** Cart line key (`productId:variantId`) — mirrors lib/cart's lineKey. */
  lineKey: string;
  name: string;
  quantity: number;
  /** Effective unit price (sale ?? list) — the exact basePrice the
   * backend's per-unit coupon resolution runs against. */
  unitPrice: number;
}

/** 98-F2: the cart lines as coupon-validation inputs. */
export function couponQuoteLines(items: LocalCartItem[]): CouponQuoteLine[] {
  return items.map((it) => ({
    lineKey: `${it.productId}:${it.variantId ?? 0}`,
    name: it.name,
    quantity: it.quantity,
    unitPrice: it.salePriceLYD ?? it.priceLYD,
  }));
}

export type CouponQuoteResult =
  | {
      status: "valid";
      /** Per-unit post-coupon final, keyed by cart line key. */
      lineUnitFinals: Record<string, number>;
      /** Σ unitFinal × qty — exactly what the per-unit loop will charge. */
      finalAmount: number;
      /** basketBase − finalAmount, rounded so «المجموع الفرعي − خصم =
       * الإجمالي» stays arithmetically consistent on the label. */
      discountAmount: number;
    }
  | { status: "invalid"; message: string; lineName: string }
  | { status: "network" };

/**
 * 98-F2 (R98-A3 F1 / P1): validate a coupon against every DISTINCT cart
 * line's UNIT price and compute the per-unit-honest basket math.
 *
 * Deduplication: ONE request per DISTINCT unit price — the endpoint's
 * result is a pure function of (code, order_amount), so identical prices
 * share the answer. /api/coupons/validate is rate-limited 10/min/user
 * (the enumeration guard in app.ts); carts are small and same-price
 * lines never multiply the budget.
 *
 * Outcome contract:
 *   • "invalid" — at least one line fails (e.g. below_min_order): the
 *     coupon is invalid FOR THE BASKET and the precise Arabic reason for
 *     the first failing line (basket order) is returned. The confirm
 *     pre-flight aborts BEFORE any charge.
 *   • "network" — at least one request was network-level inconclusive:
 *     applyCoupon surfaces a retryable notice; the confirm pre-flight
 *     fails OPEN (the server re-validates the coupon on every unit
 *     order anyway — see the pre-flight block in handleConfirm).
 *   • "valid" — every line validated; per-unit finals are the same
 *     expression the backend charges per unit (validate's
 *     +(order_amount − discount).toFixed(2) === pricing.ts's
 *     +(basePrice − discount).toFixed(2)).
 */
export async function validateCouponForLines(
  code: string,
  lines: CouponQuoteLine[],
  token: string | null,
): Promise<CouponQuoteResult> {
  const distinctPrices: number[] = [];
  for (const line of lines) {
    if (!distinctPrices.some((p) => p === line.unitPrice)) distinctPrices.push(line.unitPrice);
  }
  const responses = await Promise.all(
    distinctPrices.map(async (price) => {
      try {
        const res = await fetch("/api/coupons/validate", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          credentials: "include",
          body: JSON.stringify({ code, order_amount: price }),
        });
        const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
        return { price, res, body };
      } catch {
        return { price, res: null, body: null };
      }
    }),
  );
  // ANY network-level failure leaves the coupon's applicability to the
  // basket UNKNOWN — inconclusive for the whole pre-flight.
  if (responses.some((r) => r.res === null)) return { status: "network" };
  // HTTP-level lookup per distinct price (res non-null after the guard;
  // the redundant check below keeps the narrowed type without an `as`).
  const byPrice = new Map<number, { res: Response; body: Record<string, unknown> | null }>();
  for (const r of responses) {
    if (!r.res) continue;
    byPrice.set(r.price, { res: r.res, body: r.body });
  }
  // First INVALID line in BASKET order — the error names the first line
  // the shopper sees, carrying the backend's precise Arabic reason.
  for (const line of lines) {
    const r = byPrice.get(line.unitPrice)!;
    if (!(r.res.ok && r.body && r.body.valid === true)) {
      const message =
        (r.body && typeof r.body.error === "string" && r.body.error) || "الكوبون غير صالح";
      return { status: "invalid", message, lineName: line.name };
    }
  }
  // Valid on every line — compute the per-unit honest math.
  const lineUnitFinals: Record<string, number> = {};
  let finalAmount = 0;
  let baseAmount = 0;
  for (const line of lines) {
    const r = byPrice.get(line.unitPrice)!;
    const unitFinal = Number(r.body?.final_amount);
    if (!Number.isFinite(unitFinal)) {
      return {
        status: "invalid",
        message: "استجابة تحقق غير صالحة — أعد المحاولة",
        lineName: line.name,
      };
    }
    const roundedUnitFinal = roundToCents(unitFinal);
    lineUnitFinals[line.lineKey] = roundedUnitFinal;
    finalAmount += roundedUnitFinal * line.quantity;
    baseAmount += line.unitPrice * line.quantity;
  }
  const total = roundToCents(finalAmount);
  const discount = roundToCents(roundToCents(baseAmount) - total);
  return { status: "valid", lineUnitFinals, finalAmount: total, discountAmount: discount };
}
