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
 *     → [R115 cap] flash% + coupon% (vs list) ≤ max_total_discount_pct
 *                  — else the coupon is rejected: total_discount_cap
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
import { roundLyd } from "./money";
import { getPricingConfig } from "./pricing-config";

// ── Public types ───────────────────────────────────────────────────────────

export type CouponType = "percentage" | "fixed";

export type CouponInvalidReason =
  | "not_found"
  | "inactive"
  | "expired"
  | "max_uses_reached"
  | "below_min_order"
  | "invalid_value"
  | "total_discount_cap";

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
 * The currently-active flash sale (if any), WITHOUT any price math.
 *
 * R123 (E1): extracted from applyFlashSale so consumers that need the
 * sale METADATA only — routes/coupons.ts /validate, which receives the
 * post-flash effective price and reconstructs the list price for the
 * combined-cap evaluation — share the exact same lookup (ONE source of
 * truth: same predicate, same parsing) as the checkout pipeline.
 *
 * At most one active row exists: uniq_flash_sales_active_singleton
 * (partial unique index, migrate.ts). Read-only.
 */
export async function getActiveFlashSale(): Promise<AppliedFlashSale | null> {
  const now = new Date();
  const [row] = await db
    .select()
    .from(flashSalesTable)
    .where(and(eq(flashSalesTable.isActive, true), gt(flashSalesTable.endsAt, now)))
    .limit(1);

  if (!row) return null;

  return {
    id: row.id,
    title: row.title,
    discountPercent: parseFloat(String(row.discountPercent)),
    endsAt: row.endsAt.toISOString(),
  };
}

/**
 * Look up the currently-active flash sale (if any) and return the
 * post-flash-sale base price. Used standalone by routes/products.ts
 * (catalog + product detail need just this stage).
 *
 * Read-only. Returns `{ flashSale: null, basePrice: listPrice }` when
 * no sale is active.
 */
export async function applyFlashSale(listPrice: number): Promise<FlashSaleStage> {
  const flashSale = await getActiveFlashSale();
  if (!flashSale) {
    return { flashSale: null, basePrice: listPrice };
  }
  return {
    flashSale,
    basePrice: computeFlashSalePrice(listPrice, flashSale.discountPercent),
  };
}

// ── Stage 2: coupon (computed against the post-flash-sale basePrice) ───────

interface CouponInput {
  code: string;
  basePrice: number;
  /** R115 (Part 14): for the combined-discount cap — the pre-flash list
   * price and the flash discount percent, so the coupon can be evaluated
   * against the TOTAL stack, not just its own slice. */
  listPrice: number;
  flashDiscountPct: number;
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

  // F8 (round-98 A3): legacy percentage rows with value >= 100 (created
  // before the create-side bound at routes/coupons.ts) sailed through
  // here into computeCouponDiscount, producing discountAmount >= basePrice
  // → negative finalPrice → the checkout money-integrity gate 500s
  // (INVALID_PRICE, fail-closed but operator-hostile). Reject them with
  // the same InvalidCoupon shape below_min_order uses — a clean 400
  // INVALID_COUPON at the route, consistent with /coupons/validate's
  // non-positive-final rejection. Deliberately NOT clamped: silently
  // capping a 150% coupon at ~100% changes money semantics without an
  // operator ever noticing.
  if (row.type === "percentage" && value >= 100) {
    return {
      code,
      reason: "invalid_value",
      reasonAr: "نسبة خصم الكوبون يجب أن تكون أقل من 100%",
      record: row,
    };
  }

  const appliedAmount = computeCouponDiscount(row.type as CouponType, value, input.basePrice);

  // R115 (Part 14): promotion-stacking guardrail. The coupon is valid on
  // its own, but flash + coupon TOGETHER may exceed the configured cap
  // (pricing.max_total_discount_pct, default 50% — the no-loss line at
  // the live catalog's uniform 100% markup). Reject with a clean reason
  // the route surfaces as 400 — never a silent clamp (money semantics)
  // and never a checkout-money-gate 500 (the F8 class). Loyalty/referral
  // liabilities are deliberately NOT part of this cap: they are program
  // costs, not transactional discounts (see docs/pricing/PRICING_ECONOMICS.md).
  const { maxTotalDiscountPct } = await getPricingConfig();
  const cap = evaluateTotalDiscountCap({
    listPrice: input.listPrice,
    flashDiscountPct: input.flashDiscountPct,
    couponDiscountAmount: appliedAmount,
    maxTotalDiscountPct,
  });
  if (cap.capped) {
    return {
      code,
      reason: "total_discount_cap",
      reasonAr: totalDiscountCapMessage(cap.combinedPct, maxTotalDiscountPct),
      record: row,
    };
  }

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
    coupon = await resolveCoupon({
      code: input.couponCode,
      basePrice,
      listPrice: input.listPrice,
      flashDiscountPct: flashSale?.discountPercent ?? 0,
    });
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
//    DB-backed functions above delegate to these.
//
//    R123 (E1, P3): both functions round through lib/money.roundLyd —
//    the canonical epsilon-corrected half-up idiom (docs/pricing/
//    PRICING_ECONOMICS.md §1) already used at the topup boundaries —
//    instead of +toFixed(2). toFixed rounds the STORED DOUBLE, so an
//    intended exact half-cent (e.g. 89.99 × 50% = 44.995, stored as
//    44.994999…) rounded DOWN to 44.99 while Postgres numeric semantics
//    round the intended decimal half-UP to 45.00. Values outside the
//    1e-9 binary-dust zone are unchanged.

/** Apply a flash-sale percentage to a list price. Clamped to ≥ 0. */
export function computeFlashSalePrice(listPrice: number, discountPercent: number): number {
  return roundLyd(Math.max(0, listPrice * (1 - discountPercent / 100)));
}

/**
 * Compute the coupon discount amount against a base price.
 *   - percentage: basePrice × value/100
 *   - fixed:      min(value, basePrice)  (never discounts more than the price)
 */
export function computeCouponDiscount(type: CouponType, value: number, basePrice: number): number {
  return type === "percentage"
    ? roundLyd((basePrice * value) / 100)
    : roundLyd(Math.min(value, basePrice));
}

// ── R115 combined-cap evaluation — shared by resolveCoupon (checkout)
//    and routes/coupons.ts /validate (R123-E1 parity fix), so the
//    decision AND the operator-facing message have ONE source of truth.

export interface TotalDiscountCapOutcome {
  /** flash% + coupon% expressed against the LIST price (the R115 figure). */
  combinedPct: number;
  /** true ⇒ the stack crosses max_total_discount_pct — reject the coupon. */
  capped: boolean;
}

/**
 * Promotion-stacking guardrail math (R115 Part 14): flash sale percent +
 * coupon discount expressed as a percent of the list price, compared
 * against pricing.max_total_discount_pct. Pure; callers own the config
 * read (resolveCoupon) or supply their own (validate).
 */
export function evaluateTotalDiscountCap(input: {
  listPrice: number;
  flashDiscountPct: number;
  couponDiscountAmount: number;
  maxTotalDiscountPct: number;
}): TotalDiscountCapOutcome {
  const combinedPct =
    input.listPrice > 0
      ? input.flashDiscountPct + (input.couponDiscountAmount / input.listPrice) * 100
      : 0;
  return { combinedPct, capped: combinedPct > input.maxTotalDiscountPct + 1e-9 };
}

/**
 * The shared Arabic message for a capped stack — resolveCoupon's reasonAr
 * and /coupons/validate's 400 body use the same text, so the money screen
 * and the checkout refusal can never disagree on the WHY either.
 */
export function totalDiscountCapMessage(combinedPct: number, maxTotalDiscountPct: number): string {
  return `الخصم المجمّع (تخفيضات + كوبون) سيبلغ ${combinedPct.toFixed(0)}% ويتجاوز الحد الأقصى المسموح ${maxTotalDiscountPct}% — استخدم أحدهما فقط`;
}
