import { roundToCents, type LocalCartItem } from "@/lib/cart";
import { validateCoupon as validateCouponApi } from "@workspace/api-client-react";

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
 *   • "network" — at least one request was inconclusive at the HTTP
 *     level (429 rate-limit / 5xx / boot-gate exhaustion / unparseable
 *     body / timeout / raw network failure): applyCoupon surfaces a
 *     retryable notice; the confirm pre-flight fails OPEN (the server
 *     re-validates the coupon on every unit order anyway — see the
 *     pre-flight block in handleConfirm). L5-2 (R143): this arm used to
 *     swallow ONLY fetch-level rejections — any HTTP response that
 *     wasn't 200+valid (a 429 text body, an HTML 502) was misclassified
 *     as a definitive «الكوبون غير صالح» verdict, converting a transient
 *     condition into an instruction to drop the coupon (full-price
 *     payment) on a money screen.
 *   • "valid" — every line validated; per-unit finals are the same
 *     expression the backend charges per unit (validate's
 *     +(order_amount − discount).toFixed(2) === pricing.ts's
 *     +(basePrice − discount).toFixed(2)).
 */
export async function validateCouponForLines(
  code: string,
  lines: CouponQuoteLine[],
): Promise<CouponQuoteResult> {
  const distinctPrices: number[] = [];
  for (const line of lines) {
    if (!distinctPrices.some((p) => p === line.unitPrice)) distinctPrices.push(line.unitPrice);
  }
  // Per-distinct-price record in the legacy {ok, body} shape so the
  // downstream scan (basket-order first-invalid-line + per-unit math)
  // stays byte-identical; `null` marks a TRANSIENT outcome (L5-2).
  const responses = await Promise.all(
    distinctPrices.map(
      async (
        price,
      ): Promise<{ price: number; ok: boolean; body: Record<string, unknown> | null } | null> => {
        try {
          // L5-1 (R143): this rode a raw `fetch` with NO abort — a stalled
          // NAT link kept the «تحقق» spinner / the confirm CTA's
          // «جارٍ المعالجة… 0/N» armed until the browser's ~300 s TCP
          // timeout, and a cold-start 503 surfaced as a coupon failure
          // instead of riding customFetch's side-effect-free boot-gate
          // retry. The generated validateCoupon() rides customFetch's 20 s
          // budget + ApiError envelope (the R142 C-1 idiom product.tsx
          // landed for the PDP twin); auth rides the shared bearer-token
          // getter main.tsx registers, so the hand-built Authorization
          // header (and the `token` parameter) is gone.
          const data = await validateCouponApi({ code, order_amount: price });
          return { price, ok: true, body: data as unknown as Record<string, unknown> };
        } catch (err: unknown) {
          // L5-2 (R143): classify the HTTP verdict honestly instead of
          // treating every non-2xx as «الكوبون غير صالح».
          if (err instanceof Error && err.name === "ApiError") {
            const status = (err as { status?: unknown }).status;
            const envelope = (err as { data?: unknown }).data as Record<string, unknown> | null;
            const message = envelope && typeof envelope.error === "string" ? envelope.error : null;
            // ONLY a 4xx (rate-limit excepted) carrying a parsed Arabic
            // {error} envelope is a definitive verdict ABOUT THE COUPON
            // (not-found / inactive / expired / maxed / min-order / cap).
            // 429 and 5xx say nothing about the coupon; an unparseable
            // body (proxy HTML) says nothing either — both are transient,
            // i.e. the fail-open "network" arm.
            if (
              typeof status === "number" &&
              status >= 400 &&
              status < 500 &&
              status !== 429 &&
              message !== null
            ) {
              return { price, ok: false, body: { valid: false, error: message } };
            }
          }
          return null;
        }
      },
    ),
  );
  // ANY transient outcome (429 / 5xx / timeout / network / unparseable)
  // leaves the coupon's applicability to the basket UNKNOWN —
  // inconclusive for the whole pre-flight (L5-2: previously only a
  // fetch-level rejection landed here).
  if (responses.some((r) => r === null)) return { status: "network" };
  // HTTP-level lookup per distinct price (non-null after the guard
  // above; the redundant check below keeps the narrowed type without
  // an `as`).
  const byPrice = new Map<number, { ok: boolean; body: Record<string, unknown> | null }>();
  for (const r of responses) {
    if (!r) continue;
    byPrice.set(r.price, r);
  }
  // First INVALID line in BASKET order — the error names the first line
  // the shopper sees, carrying the backend's precise Arabic reason.
  for (const line of lines) {
    const r = byPrice.get(line.unitPrice)!;
    if (!(r.ok && r.body && r.body.valid === true)) {
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
