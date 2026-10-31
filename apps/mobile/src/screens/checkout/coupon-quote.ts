import type { LocalCartItem } from "@/lib/cart";
import type { ValidateCouponBody, ValidatedCoupon } from "@workspace/api-client-native";

import { readApiError } from "./checkout-errors";

/**
 * Per-line coupon validation — the native port of the web's
 * components/checkout/coupon-quote.ts (98-F2): the backend applies a
 * coupon PER UNIT against each unit's basePrice (the per-unit order
 * loop sends coupon_code on every unit order), so the pre-flight
 * validates against every DISTINCT cart line's UNIT price — the exact
 * input the server's per-unit pricing runs against — and the label and
 * balance gate are computed from the per-unit finals exactly as the
 * server charges them.
 *
 * The server stays authoritative: every unit order re-validates the
 * coupon regardless of what this pre-flight concludes.
 */

/** Round a money amount to 2 decimal places (the web's roundToCents). */
export function roundToCents(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface CouponQuoteLine {
  /** Cart line key (`productId:variantId`) — mirrors lib/cart's lineKey. */
  lineKey: string;
  name: string;
  quantity: number;
  /** Effective unit price (sale ?? list) — the backend's per-unit basePrice. */
  unitPrice: number;
}

/** The cart lines as coupon-validation inputs. */
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
      /** basketBase − finalAmount, rounded so the label stays consistent. */
      discountAmount: number;
    }
  | { status: "invalid"; message: string; lineName: string }
  | { status: "network" };

/**
 * Validate a coupon against every DISTINCT cart line's UNIT price and
 * compute the per-unit-honest basket math. `validate` is injected by the
 * screen (the generated useValidateCoupon mutation's mutateAsync) so
 * this module stays React-free.
 *
 * Deduplication: ONE request per DISTINCT unit price — the endpoint's
 * result is a pure function of (code, order_amount) and
 * /api/coupons/validate is rate-limited 10/min/user.
 *
 * Outcome contract (the web's L5-2 honesty rule):
 *   • "invalid" — at least one line fails (e.g. below_min_order): the
 *     precise Arabic reason for the first failing line, in basket order.
 *   • "network" — at least one request was inconclusive (429 / 5xx /
 *     timeout / unparseable body): the pre-flight fails OPEN — the
 *     server re-validates on every unit order anyway.
 *   • "valid" — every line validated; the per-unit finals are the same
 *     expression the backend charges per unit.
 */
export async function validateCouponForLines(
  code: string,
  lines: CouponQuoteLine[],
  validate: (body: ValidateCouponBody) => Promise<ValidatedCoupon>,
): Promise<CouponQuoteResult> {
  const distinctPrices: number[] = [];
  for (const line of lines) {
    if (!distinctPrices.some((p) => p === line.unitPrice)) distinctPrices.push(line.unitPrice);
  }
  const responses = await Promise.all(
    distinctPrices.map(
      async (
        price,
      ): Promise<{ price: number; ok: boolean; body: Record<string, unknown> | null } | null> => {
        try {
          const data = await validate({ code, order_amount: price });
          return { price, ok: true, body: data as unknown as Record<string, unknown> };
        } catch (err: unknown) {
          const api = readApiError(err);
          if (api !== null) {
            const envelope = api.data;
            const message = envelope && typeof envelope.error === "string" ? envelope.error : null;
            // ONLY a 4xx (rate-limit excepted) carrying a parsed {error}
            // envelope is a definitive verdict ABOUT THE COUPON; 429/5xx
            // say nothing about it — both are transient ("network").
            if (
              api.status !== undefined &&
              api.status >= 400 &&
              api.status < 500 &&
              api.status !== 429 &&
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
  // ANY transient outcome leaves the coupon's applicability UNKNOWN.
  if (responses.some((r) => r === null)) return { status: "network" };
  const byPrice = new Map<number, { ok: boolean; body: Record<string, unknown> | null }>();
  for (const r of responses) {
    if (!r) continue;
    byPrice.set(r.price, r);
  }
  // First INVALID line in BASKET order — names the line the shopper sees.
  for (const line of lines) {
    const r = byPrice.get(line.unitPrice)!;
    if (!(r.ok && r.body && r.body.valid === true)) {
      const message =
        (r.body && typeof r.body.error === "string" && r.body.error) || "الكوبون غير صالح";
      return { status: "invalid", message, lineName: line.name };
    }
  }
  // Valid on every line — the per-unit honest math.
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
