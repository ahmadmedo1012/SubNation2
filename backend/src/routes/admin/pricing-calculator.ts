/**
 * Admin pricing calculator endpoint.
 *
 * Read-only profit/margin simulator for the operator. Mirrors the EXACT
 * order-pipeline math from `routes/orders.ts` (basePrice → flashSale →
 * coupon → finalPrice) so what the calculator shows is what users would
 * actually pay. Computes margins relative to the operator-supplied
 * `cost_price` (procurement cost — added in the same Increment 1).
 *
 * IMPORTANT GUARANTEES:
 *   - Does NOT mutate any product, coupon, flash sale, or order.
 *   - Does NOT change checkout behavior in any way.
 *   - Does NOT fire side effects (no notifications, no audit log).
 *   - Mirrors order-pipeline math; if the real pipeline changes, this
 *     calculator MUST be updated to match. (Audit reference comment in
 *     `routes/orders.ts:88-148` is the source of truth.)
 *
 * Welcome bonus is hardcoded to 5.00 LYD here, matching the runtime
 * value at firebase-auth.service.ts:363 and auth-settings.ts:383.
 * Referrer points (50) and POINTS_PER_LYD (100) come from the
 * loyalty module directly so any future tuning there is reflected.
 */

import { db, productsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { Router } from "express";
import { computePricing, isAppliedCoupon } from "../../lib/pricing";
import { requireAdmin } from "../../middlewares/requireAdmin";
import { POINTS_PER_LYD, POINTS_PER_REFERRAL } from "../loyalty";
import { ErrorCode, createErrorResponse } from "../../lib/errors";

const router = Router();

/** Welcome bonus in LYD — mirrors firebase-auth.service.ts and auth-settings.ts. */
const WELCOME_BONUS_LYD = 5.0;

interface CalculatorInputs {
  product_id?: number;
  price?: number;
  cost_price?: number | null;
  coupon_code?: string;
  simulate_referred?: boolean;
}

interface CalculatorWarning {
  severity: "loss" | "low_margin" | "info";
  code: string;
  message_ar: string;
}

router.post("/pricing/calculate", requireAdmin, async (req, res) => {
  const body = (req.body ?? {}) as CalculatorInputs;

  // ── Resolve product OR direct price+cost ──────────────────────────────
  let listPrice = 0;
  let costPrice: number | null = null;
  let productName: string | null = null;
  let productId: number | null = null;

  if (typeof body.product_id === "number") {
    const [p] = await db
      .select()
      .from(productsTable)
      .where(eq(productsTable.id, body.product_id))
      .limit(1);
    if (!p) {
      return res.status(404).json(createErrorResponse("المنتج غير موجود", ErrorCode.NOT_FOUND));
    }
    listPrice = parseFloat(String(p.price));
    costPrice = p.costPrice != null ? parseFloat(String(p.costPrice)) : null;
    productName = p.name;
    productId = p.id;
  } else if (typeof body.price === "number") {
    listPrice = body.price;
    costPrice = typeof body.cost_price === "number" ? body.cost_price : null;
  } else {
    return res.status(400).json(createErrorResponse("أدخل معرف منتج أو سعراً مباشراً", ErrorCode.INVALID_DATA));
  }

  if (listPrice < 0) {
    return res.status(400).json(createErrorResponse("السعر لا يمكن أن يكون سالباً", ErrorCode.INVALID_DATA));
  }

  // ── Discount stack (delegates to lib/pricing.ts) ─────────────────────
  // Same shared pipeline used by routes/orders.ts at checkout, so the
  // simulation is bit-for-bit identical to what the real order path
  // would compute. The shapes below are translated to the calculator's
  // existing snake_case response schema.
  const pricing = await computePricing({
    listPrice,
    couponCode: body.coupon_code ?? null,
  });

  const basePrice = pricing.basePrice;
  const finalPrice = pricing.finalPrice;
  const discountAmount = pricing.discountAmount;

  const flashSaleApplied: { discount_percent: number; title: string } | null = pricing.flashSale
    ? {
        discount_percent: pricing.flashSale.discountPercent,
        title: pricing.flashSale.title,
      }
    : null;

  const couponInfo: {
    code: string;
    type: "percentage" | "fixed";
    value: number;
    valid: boolean;
    reason_invalid: string | null;
  } | null = (() => {
    if (!pricing.coupon) return null;
    if (isAppliedCoupon(pricing.coupon)) {
      return {
        code: pricing.coupon.code,
        type: pricing.coupon.type,
        value: pricing.coupon.value,
        valid: true,
        reason_invalid: null,
      };
    }
    return {
      code: pricing.coupon.code,
      // The invalid-coupon shape doesn't carry type/value when the row
      // wasn't found; mirror the previous endpoint behaviour (default
      // to "percentage" / 0) so the response schema stays stable.
      type: (pricing.coupon.record?.type as "percentage" | "fixed" | undefined) ?? "percentage",
      value: pricing.coupon.record ? parseFloat(String(pricing.coupon.record.value)) : 0,
      valid: false,
      reason_invalid: pricing.coupon.reasonAr,
    };
  })();

  // ── Margin math ───────────────────────────────────────────────────────
  const loyaltyPointsEarned = Math.floor(finalPrice);
  const loyaltyLydAccrued = +(loyaltyPointsEarned / POINTS_PER_LYD).toFixed(4);

  // Gross: revenue minus operator cost (procurement)
  const grossLyd = costPrice != null ? +(finalPrice - costPrice).toFixed(4) : null;
  const grossPct =
    costPrice != null && finalPrice > 0
      ? +((grossLyd! / finalPrice) * 100).toFixed(2)
      : null;

  // Net: gross minus loyalty accrual (1% perpetual dilution)
  const netLyd = grossLyd != null ? +(grossLyd - loyaltyLydAccrued).toFixed(4) : null;
  const netPct =
    netLyd != null && finalPrice > 0 ? +((netLyd / finalPrice) * 100).toFixed(2) : null;

  // Referral-adjusted: net minus welcome bonus (5.00) and referrer points (0.50)
  // Only meaningful for first purchase by a referred user.
  const referralCostLyd = +(WELCOME_BONUS_LYD + POINTS_PER_REFERRAL / POINTS_PER_LYD).toFixed(4);
  const refLyd =
    netLyd != null && body.simulate_referred ? +(netLyd - referralCostLyd).toFixed(4) : null;
  const refPct =
    refLyd != null && finalPrice > 0 ? +((refLyd / finalPrice) * 100).toFixed(2) : null;

  // ── Warnings ──────────────────────────────────────────────────────────
  const warnings: CalculatorWarning[] = [];
  if (costPrice == null) {
    warnings.push({
      severity: "info",
      code: "no_cost_price",
      message_ar: "لم يتم تحديد سعر التكلفة لهذا المنتج — لن يظهر هامش الربح.",
    });
  } else {
    if (grossLyd! < 0) {
      warnings.push({
        severity: "loss",
        code: "loss_on_transaction",
        message_ar: `خسارة مباشرة: ستبيع بأقل من سعر التكلفة بمقدار ${Math.abs(grossLyd!).toFixed(2)} د.ل.`,
      });
    } else if (grossPct! < 5) {
      warnings.push({
        severity: "low_margin",
        code: "thin_gross_margin",
        message_ar: `هامش الربح الإجمالي ضعيف جداً (${grossPct!.toFixed(1)}%). راجع التسعير.`,
      });
    }
    if (netLyd != null && netLyd < 0) {
      warnings.push({
        severity: "loss",
        code: "loss_after_loyalty",
        message_ar: "صافي الربح سالب بعد احتساب نقاط الولاء.",
      });
    }
    if (refLyd != null && refLyd < 0) {
      warnings.push({
        severity: "loss",
        code: "loss_after_referral",
        message_ar: `إذا كان المشتري مُحالاً، الخسارة الكلية ${Math.abs(refLyd).toFixed(2)} د.ل (يشمل مكافأة الترحيب 5 د.ل + 0.50 د.ل للمُحيل).`,
      });
    }
  }
  if (
    couponInfo &&
    couponInfo.valid &&
    couponInfo.type === "percentage" &&
    couponInfo.value > 50
  ) {
    warnings.push({
      severity: "low_margin",
      code: "aggressive_coupon",
      message_ar: `الكوبون يخصم ${couponInfo.value}% — قد يضغط الهامش بشدة.`,
    });
  }
  if (flashSaleApplied && couponInfo && couponInfo.valid) {
    warnings.push({
      severity: "info",
      code: "flash_plus_coupon",
      message_ar: "خصم تخفيضات + كوبون مُجمعان — تأكد أن السعر النهائي يبقى مربحاً.",
    });
  }

  // ── Response ──────────────────────────────────────────────────────────
  return res.json({
    inputs: {
      product_id: productId,
      product_name: productName,
      list_price: listPrice,
      cost_price: costPrice,
      coupon_code: body.coupon_code ?? null,
      simulate_referred: body.simulate_referred === true,
    },
    flash_sale: flashSaleApplied,
    coupon: couponInfo,
    pricing: {
      list_price: listPrice,
      base_price: basePrice,
      discount_amount: discountAmount,
      final_price: finalPrice,
    },
    loyalty: {
      points_earned: loyaltyPointsEarned,
      lyd_accrued: loyaltyLydAccrued,
      points_per_lyd: POINTS_PER_LYD,
    },
    referral_cost: {
      welcome_bonus_lyd: WELCOME_BONUS_LYD,
      referrer_points: POINTS_PER_REFERRAL,
      referrer_lyd_value: +(POINTS_PER_REFERRAL / POINTS_PER_LYD).toFixed(4),
      total_referral_cost_lyd: referralCostLyd,
    },
    margins: {
      gross_lyd: grossLyd,
      gross_pct: grossPct,
      net_lyd: netLyd,
      net_pct: netPct,
      referral_adjusted_lyd: refLyd,
      referral_adjusted_pct: refPct,
    },
    warnings,
  });
});

export { router as adminPricingCalculatorRouter };
