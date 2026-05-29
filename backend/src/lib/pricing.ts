/**
 * Shared pricing pipeline.
 *
 * Single source of truth for the discount stack used by:
 *   - routes/products.ts (catalog + product detail — flash sale only)
 *   - routes/orders.ts (checkout — flash sale + coupon)
 *   - routes/admin/pricing-calculator.ts (admin simulation — full stack)
 *
 * Pipeline:
 *
 *   listPrice
 *     → flashSale: basePrice = listPrice × (1 − discount_percent/100)
 *     → coupon:    discountAmount = (
 *                    percentage : basePrice × value/100
 *                    fixed      : min(value, basePrice)
 *                  )
 *     → finalPrice = basePrice − discountAmount   (clamped to ≥0 by min())
 *
 * The pipeline is read-only (does not mutate flash_sales / coupons /
 * orders) and side-effect-free (no Sentry / log / metric calls). All
 * outcomes are returned in the structured PricingResult so callers can
 * shape their own response (orders.ts → 400 on invalid coupon;
 * calculator → embed in body; products.ts → ignore coupon entirely).
 *
 * IMPORTANT: this file is the *only* place the discount math should
 * live. If you need to change the order or formulas, change it here
 * and every dependent surface picks it up consistently.
 */

import { couponsTable, db, flashSalesTable } from "@workspace/db";
import { and, eq, gt } from "drizzle-orm";

// ── Public types ───────────────────────────────────────────────────────────

export type CouponType = "percentage" | "fixed";

export type CouponInvalidReason =
  | "not_found"
  | "inactive"
  | "expired"
  | "max_uses_reached"
  | "below_min_order";

export interface AppliedFlashSale {
  id: number;
  title: string;
  discountPercent: number;
  /** ISO string. Public catalog/banner uses this for the countdown. */
  endsAt: string;
}

export interface AppliedCoupon {
  /** Raw row — orders.ts uses it for usedCount increment. */
  record: typeof couponsTable.$inferSelect;
  code: string;
  type: CouponType;
  value: number;
  appliedAmount: number;
}

export interface InvalidCoupon {
  code: string;
  reason: CouponInvalidReason;
  /** Translated to Arabic for direct admin/UI display. */
  reasonAr: string;
  /** Present iff the code resolved to a row that just failed validation. */
  record: typeof couponsTable.$inferSelect | null;
}

export interface FlashSaleStage {
  flashSale: AppliedFlashSale | null;
  /** Price after applying the flash sale (= listPrice if no sale). */
  basePrice: number;
}

export interface PricingResult extends FlashSaleStage {
  listPrice: number;
  /** null = no coupon attempted; an object means attempted (valid or not). */
  coupon: AppliedCoupon | InvalidCoupon | null;
  /** Subtracted from basePrice. 0 when no valid coupon. */
  discountAmount: number;
  finalPrice: number;
}

// ── Type guards ────────────────────────────────────────────────────────────

export function isAppliedCoupon(c: AppliedCoupon | InvalidCoupon | null): c is AppliedCoupon {
  return !!c && "appliedAmount" in c;
}

export function isInvalidCoupon(c: AppliedCoupon | InvalidCoupon | null): c is InvalidCoupon {
  return !!c && "reason" in c;
}

// ── Stage 1: flash sale ────────────────────────────────────────────────────

/**
 * Look up the currently-active flash sale (if any) and return the
 * post-flash-sale base price. Used standalone by routes/products.ts
 * (catalog + product detail need just this stage).
 *
 * Read-only. Returns `{ flashSale: null, basePrice: listPrice }` when
 * no sale is active.
 */
export async function applyFlashSale(listPrice: number): Promise<FlashSaleStage> {
  const now = new Date();
  const [row] = await db
    .select()
    .from(flashSalesTable)
    .where(and(eq(flashSalesTable.isActive, true), gt(flashSalesTable.endsAt, now)))
    .limit(1);

  if (!row) {
    return { flashSale: null, basePrice: listPrice };
  }

  const discountPercent = parseFloat(String(row.discountPercent));
  const basePrice = computeFlashSalePrice(listPrice, discountPercent);
  return {
    flashSale: {
      id: row.id,
      title: row.title,
      discountPercent,
      endsAt: row.endsAt.toISOString(),
    },
    basePrice,
  };
}

// ── Stage 2: coupon (computed against the post-flash-sale basePrice) ───────

interface CouponInput {
  code: string;
  basePrice: number;
}

async function resolveCoupon(input: CouponInput): Promise<AppliedCoupon | InvalidCoupon> {
  const code = input.code.trim().toUpperCase();
  const [row] = await db.select().from(couponsTable).where(eq(couponsTable.code, code)).limit(1);

  if (!row) {
    return {
      code,
      reason: "not_found",
      reasonAr: "كوبون غير موجود",
      record: null,
    };
  }

  if (!row.isActive) {
    return { code, reason: "inactive", reasonAr: "كوبون غير مفعل", record: row };
  }

  const now = new Date();
  if (row.expiresAt && row.expiresAt < now) {
    return { code, reason: "expired", reasonAr: "انتهت صلاحية الكوبون", record: row };
  }

  if (row.maxUses !== null && row.usedCount >= row.maxUses) {
    return {
      code,
      reason: "max_uses_reached",
      reasonAr: "تم استنفاد الكوبون",
      record: row,
    };
  }

  const minOrder = parseFloat(String(row.minOrderAmount));
  if (input.basePrice < minOrder) {
    return {
      code,
      reason: "below_min_order",
      reasonAr: `يتطلب حد أدنى ${minOrder.toFixed(2)} د.ل`,
      record: row,
    };
  }

  // Valid — compute applied amount.
  const value = parseFloat(String(row.value));
  const appliedAmount = computeCouponDiscount(row.type as CouponType, value, input.basePrice);

  return {
    record: row,
    code: row.code,
    type: row.type as CouponType,
    value,
    appliedAmount,
  };
}

// ── Full pipeline ──────────────────────────────────────────────────────────

export interface ComputePricingInput {
  listPrice: number;
  couponCode?: string | null;
}

/**
 * Resolve the entire discount stack for a single product purchase.
 * Read-only. Suitable for both the live order pipeline and the admin
 * simulation calculator; the caller is responsible for converting an
 * `InvalidCoupon` into whatever response shape they need.
 */
export async function computePricing(input: ComputePricingInput): Promise<PricingResult> {
  const { flashSale, basePrice } = await applyFlashSale(input.listPrice);

  let coupon: AppliedCoupon | InvalidCoupon | null = null;
  let discountAmount = 0;
  if (input.couponCode && input.couponCode.trim()) {
    coupon = await resolveCoupon({ code: input.couponCode, basePrice });
    if (isAppliedCoupon(coupon)) discountAmount = coupon.appliedAmount;
  }

  const finalPrice = +(basePrice - discountAmount).toFixed(2);
  return {
    listPrice: input.listPrice,
    flashSale,
    basePrice,
    coupon,
    discountAmount,
    finalPrice,
  };
}

// ── Pure math (DB-free, side-effect-free) — single source for the
//    discount arithmetic so it can be unit-tested in isolation. The
//    DB-backed functions above delegate to these. ──────────────────────────

/** Apply a flash-sale percentage to a list price. Clamped to ≥ 0. */
export function computeFlashSalePrice(listPrice: number, discountPercent: number): number {
  return +Math.max(0, listPrice * (1 - discountPercent / 100)).toFixed(2);
}

/**
 * Compute the coupon discount amount against a base price.
 *   - percentage: basePrice × value/100
 *   - fixed:      min(value, basePrice)  (never discounts more than the price)
 */
export function computeCouponDiscount(type: CouponType, value: number, basePrice: number): number {
  return type === "percentage"
    ? +((basePrice * value) / 100).toFixed(2)
    : +Math.min(value, basePrice).toFixed(2);
}
