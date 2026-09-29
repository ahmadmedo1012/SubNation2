/**
 * Admin pricing calculator endpoint — R115 rewrite (variant-aware).
 *
 * The pre-R115 calculator read products.price + products.costPrice
 * (product-level denormalization): cost was NULL on essentially the whole
 * live catalog (the real costs live on VARIANTS, in USD), it could only
 * simulate the CHEAPEST variant of a product, and it subtracted an
 * unconverted product cost from an LYD price (R115-A3 P1 / R115-A5 P1-2).
 *
 * This version models the REAL sellable unit:
 *   - variant_id input → variant.price_lyd (what checkout charges) +
 *     variant.cost_price (USD) × config.usdToLyd (LYD cost), using the
 *     SAME computePricing stack as checkout (bit-identical discounts);
 *   - product_id without variant_id → the CHEAPEST active variant,
 *     labeled as such (never the raw product row);
 *   - manual mode → explicit list_price_lyd + cost_lyd sandbox values;
 *   - loyalty liability from lib/loyalty-policy (floor(finalPrice) points
 *     → LYD at 100:1), referral acquisition cost (welcome 5 + referrer
 *     0.50), the R115 combined-discount cap, break-even and safe-ceiling
 *     math, SAFE/WATCH/THIN/LOSS states with explained reasons.
 *
 * IMPORTANT GUARANTEES (unchanged):
 *   - Does NOT mutate any product, coupon, flash sale, or order.
 *   - Does NOT change checkout behavior.
 *   - Does NOT fire side effects.
 */

import { db, productVariantsTable, productsTable } from "@workspace/db";
import { and, asc, eq } from "drizzle-orm";
import { Router } from "express";
import { computePricing, isAppliedCoupon } from "../../lib/pricing";
import { getPricingConfig, round2 } from "../../lib/pricing-config";
import {
  POINTS_PER_LYD,
  POINTS_PER_REFERRAL,
  WELCOME_BONUS_LYD,
  purchaseAwardPoints,
  pointsLiabilityLyd,
  referralAcquisitionCostLyd,
} from "../../lib/loyalty-policy";
import { requireAdmin } from "../../middlewares/requireAdmin";
import { ErrorCode, createErrorResponse } from "../../lib/errors";

const router = Router();

/** The safe-margin band used for the risk states (documented thresholds). */
const WATCH_GROSS_PCT = 15; // below this: WATCH
const THIN_GROSS_PCT = 5; // below this: THIN MARGIN

interface CalculatorInputs {
  product_id?: number;
  /** R115: the sellable unit — when omitted, the product's cheapest ACTIVE variant is used. */
  variant_id?: number;
  /** Manual sandbox mode (ignored when product_id/variant_id given). */
  price?: number;
  cost_price?: number | null;
  coupon_code?: string;
  simulate_referred?: boolean;
}

interface CalculatorWarning {
  severity: "loss" | "low_margin" | "info" | "cap";
  code: string;
  message_ar: string;
}

type RiskState = "SAFE" | "WATCH" | "THIN" | "LOSS";

router.post("/pricing/calculate", requireAdmin, async (req, res) => {
  const body = (req.body ?? {}) as CalculatorInputs;

  const config = await getPricingConfig();

  // ── Resolve the sellable unit: variant > product-cheapest > manual ─────
  let listPrice = 0;
  let costLyd: number | null = null;
  let costUsd: number | null = null;
  let productName: string | null = null;
  let productId: number | null = null;
  let variantId: number | null = null;
  let variantLabel: string | null = null;
  let priceSource: "variant" | "product_cheapest_variant" | "manual" = "manual";
  let variantActive = true;

  if (typeof body.variant_id === "number" && Number.isInteger(body.variant_id)) {
    const [v] = await db
      .select({
        id: productVariantsTable.id,
        productId: productVariantsTable.productId,
        planLabel: productVariantsTable.planLabel,
        durationLabel: productVariantsTable.durationLabel,
        costPrice: productVariantsTable.costPrice,
        priceLyd: productVariantsTable.priceLyd,
        isActive: productVariantsTable.isActive,
        productName: productsTable.name,
        productArchived: productsTable.isArchived,
      })
      .from(productVariantsTable)
      .innerJoin(productsTable, eq(productsTable.id, productVariantsTable.productId))
      .where(eq(productVariantsTable.id, body.variant_id))
      .limit(1);
    if (!v) {
      return res.status(404).json(createErrorResponse("الخيار غير موجود", ErrorCode.NOT_FOUND));
    }
    variantId = v.id;
    productId = v.productId;
    productName = v.productName;
    variantLabel = [v.planLabel, v.durationLabel].filter(Boolean).join(" — ") || null;
    listPrice = parseFloat(String(v.priceLyd));
    costUsd = v.costPrice != null ? parseFloat(String(v.costPrice)) : null;
    costLyd = costUsd != null ? round2(costUsd * config.usdToLyd) : null;
    variantActive = v.isActive && !v.productArchived;
    priceSource = "variant";
  } else if (typeof body.product_id === "number" && Number.isInteger(body.product_id)) {
    // The product's CHEAPEST ACTIVE variant — exactly what a variant-less
    // checkout request would charge (checkout.service.ts), never the raw
    // denormalized products.price.
    const [v] = await db
      .select({
        id: productVariantsTable.id,
        planLabel: productVariantsTable.planLabel,
        durationLabel: productVariantsTable.durationLabel,
        costPrice: productVariantsTable.costPrice,
        priceLyd: productVariantsTable.priceLyd,
        productName: productsTable.name,
      })
      .from(productVariantsTable)
      .innerJoin(productsTable, eq(productsTable.id, productVariantsTable.productId))
      .where(
        and(
          eq(productVariantsTable.productId, body.product_id),
          eq(productVariantsTable.isActive, true),
          eq(productsTable.isArchived, false),
        ),
      )
      .orderBy(asc(productVariantsTable.priceLyd))
      .limit(1);
    if (!v) {
      return res
        .status(404)
        .json(createErrorResponse("لا يوجد منتج أو خيارات نشطة بهذا المعرف", ErrorCode.NOT_FOUND));
    }
    variantId = v.id;
    productId = body.product_id;
    productName = v.productName;
    variantLabel = [v.planLabel, v.durationLabel].filter(Boolean).join(" — ") || null;
    listPrice = parseFloat(String(v.priceLyd));
    costUsd = v.costPrice != null ? parseFloat(String(v.costPrice)) : null;
    costLyd = costUsd != null ? round2(costUsd * config.usdToLyd) : null;
    priceSource = "product_cheapest_variant";
  } else if (typeof body.price === "number") {
    listPrice = body.price;
    // Manual mode: cost_price is an explicit LYD cost (sandbox semantics —
    // the operator supplies the number they want modeled).
    costLyd = typeof body.cost_price === "number" ? body.cost_price : null;
    priceSource = "manual";
  } else {
    return res
      .status(400)
      .json(
        createErrorResponse(
          "أدخل معرف خيار (variant_id) أو معرف منتج (product_id) أو سعراً مباشراً",
          ErrorCode.INVALID_DATA,
        ),
      );
  }

  if (listPrice < 0) {
    return res
      .status(400)
      .json(createErrorResponse("السعر لا يمكن أن يكون سالباً", ErrorCode.INVALID_DATA));
  }

  // ── Discount stack (the SAME pipeline checkout runs) ────────────────────
  const pricing = await computePricing({
    listPrice,
    couponCode: body.coupon_code ?? null,
  });

  const basePrice = pricing.basePrice;
  const finalPrice = pricing.finalPrice;
  const discountAmount = pricing.discountAmount;

  const flashSaleApplied: { discount_percent: number; title: string } | null = pricing.flashSale
    ? { discount_percent: pricing.flashSale.discountPercent, title: pricing.flashSale.title }
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
      type: (pricing.coupon.record?.type as "percentage" | "fixed" | undefined) ?? "percentage",
      value: pricing.coupon.record ? parseFloat(String(pricing.coupon.record.value)) : 0,
      valid: false,
      reason_invalid: pricing.coupon.reasonAr,
    };
  })();

  // ── Margin math (variant truth: cost in LYD via the config rate) ────────
  const grossLyd = costLyd != null ? round2(finalPrice - costLyd) : null;
  const grossPct =
    costLyd != null && finalPrice > 0 ? +((grossLyd! / finalPrice) * 100).toFixed(2) : null;

  const loyaltyPointsEarned = purchaseAwardPoints(finalPrice);
  const loyaltyLydAccrued = pointsLiabilityLyd(loyaltyPointsEarned);

  // Net: gross minus the FULL-REDEMPTION loyalty liability (1% of paid).
  const netLyd = grossLyd != null ? +(grossLyd - loyaltyLydAccrued).toFixed(4) : null;
  const netPct =
    netLyd != null && finalPrice > 0 ? +((netLyd / finalPrice) * 100).toFixed(2) : null;

  const referralCostLyd = referralAcquisitionCostLyd();
  const refLyd =
    netLyd != null && body.simulate_referred === true
      ? +(netLyd - referralCostLyd).toFixed(4)
      : null;
  const refPct =
    refLyd != null && finalPrice > 0 ? +((refLyd / finalPrice) * 100).toFixed(2) : null;

  // ── Worst case + break-even + safe ceiling (R115 Part 15) ───────────────
  // Worst case = the deepest stack the CURRENT config allows: flash (if
  // active) + a coupon at exactly the remaining cap headroom, on the SAME
  // cost base. It answers "how bad can an allowed combination get?".
  const capPct = config.maxTotalDiscountPct;
  const flashPct = flashSaleApplied ? flashSaleApplied.discount_percent : 0;
  const worstCaseCouponPct = Math.max(0, capPct - flashPct);
  const worstCasePrice = round2(listPrice * (1 - capPct / 100));
  const worstCaseGross = costLyd != null ? round2(worstCasePrice - costLyd) : null;
  const worstCaseContribution =
    worstCaseGross != null
      ? +(worstCaseGross - pointsLiabilityLyd(purchaseAwardPoints(worstCasePrice))).toFixed(4)
      : null;
  const worstCaseReferred =
    worstCaseContribution != null ? +(worstCaseContribution - referralCostLyd).toFixed(4) : null;

  // Break-even price: finalPrice where gross = 0 (cost recovery).
  const breakEvenPrice = costLyd != null ? round2(costLyd) : null;
  // Safe minimum: price at which contribution stays ≥ 0 including the full
  // program stack (loyalty liability + referred acquisition cost):
  //   p×(1−f)×(1−c) − cost − p×(1−f)×(1−c)/100 − referral ≥ 0
  //   p × (1−f)×(1−c)×(1−1/POINTS_PER_LYD) ≥ cost + referral
  const netUnitFactor =
    (1 - flashPct / 100) * (1 - worstCaseCouponPct / 100) * (1 - 1 / POINTS_PER_LYD);
  const safeMinPrice =
    costLyd != null && netUnitFactor > 0
      ? round2((costLyd + referralCostLyd) / netUnitFactor)
      : null;
  // Max safe discount % at the CURRENT list price (vs cost, before program costs):
  const maxSafeDiscountPct =
    costLyd != null && listPrice > 0 ? +((1 - costLyd / listPrice) * 100).toFixed(1) : null;

  // ── Risk state (explained, never vague) ─────────────────────────────────
  let riskState: RiskState = "SAFE";
  if (grossLyd == null) {
    riskState = "WATCH";
  } else if (grossLyd <= 0) {
    riskState = "LOSS";
  } else if (grossPct! < THIN_GROSS_PCT) {
    riskState = "THIN";
  } else if (grossPct! < WATCH_GROSS_PCT) {
    riskState = "WATCH";
  }

  // ── Warnings ────────────────────────────────────────────────────────────
  const warnings: CalculatorWarning[] = [];
  if (costLyd == null) {
    warnings.push({
      severity: "info",
      code: "no_cost_price",
      message_ar: "لم يتم تحديد سعر التكلفة لهذا الخيار — لن يظهر هامش الربح.",
    });
  } else {
    if (grossLyd! <= 0) {
      warnings.push({
        severity: "loss",
        code: "loss_on_transaction",
        message_ar: `خسارة مباشرة: ستبيع بأقل من سعر التكلفة بمقدار ${Math.abs(grossLyd!).toFixed(2)} د.ل.`,
      });
    } else if (grossPct! < THIN_GROSS_PCT) {
      warnings.push({
        severity: "low_margin",
        code: "thin_gross_margin",
        message_ar: `هامش الربح الإجمالي ضعيف جداً (${grossPct!.toFixed(1)}%) — أقل من ${THIN_GROSS_PCT}%. راجع التسعير.`,
      });
    } else if (grossPct! < WATCH_GROSS_PCT) {
      warnings.push({
        severity: "low_margin",
        code: "watch_gross_margin",
        message_ar: `هامش الربح الإجمالي تحت المراقبة (${grossPct!.toFixed(1)}%) — أقل من ${WATCH_GROSS_PCT}%.`,
      });
    }
    if (netLyd != null && netLyd < 0) {
      warnings.push({
        severity: "loss",
        code: "loss_after_loyalty",
        message_ar: "صافي الربح سالب بعد احتساب التزام نقاط الولاء (1% من المدفوع).",
      });
    }
    if (refLyd != null && refLyd < 0) {
      warnings.push({
        severity: "loss",
        code: "loss_after_referral",
        message_ar: `إذا كان المشتري مُحالاً، الخسارة الكلية ${Math.abs(refLyd).toFixed(2)} د.ل (يشمل مكافأة الترحيب 5 د.ل + 0.50 د.ل نقاط المُحيل).`,
      });
    }
  }
  if (priceSource === "product_cheapest_variant") {
    warnings.push({
      severity: "info",
      code: "cheapest_variant_used",
      message_ar:
        "تمت المحاكاة على أرخص خيار نشط للمنتج — اختر خياراً محدداً (variant_id) لمحاكاة سعره الفعلي عند الدفع.",
    });
  }
  if (variantId != null && !variantActive && priceSource === "variant") {
    warnings.push({
      severity: "info",
      code: "variant_unavailable",
      message_ar: "هذا الخيار غير نشط حالياً — لا يمكن شراؤه حتى يُفعَّل.",
    });
  }
  if (couponInfo && couponInfo.valid && couponInfo.type === "percentage" && couponInfo.value > 50) {
    warnings.push({
      severity: "low_margin",
      code: "aggressive_coupon",
      message_ar: `الكوبون يخصم ${couponInfo.value}% — قد يضغط الهامش بشدة.`,
    });
  }
  if (flashSaleApplied && couponInfo && couponInfo.valid) {
    warnings.push({
      severity: "cap",
      code: "flash_plus_coupon",
      message_ar: `خصم تخفيضات + كوبون مُجمعان (${(flashPct + (discountAmount / listPrice) * 100).toFixed(0)}% من السعر الأصلي) — تحت سقف ${capPct}% المسموح.`,
    });
  }
  if (flashSaleApplied && flashPct >= capPct) {
    warnings.push({
      severity: "cap",
      code: "flash_exhausts_cap",
      message_ar: `التخفيض الحالي ${flashPct}% يستهلك كامل سقف الخصم المسموح (${capPct}%) — أي كوبون سيُرفض عند الدفع.`,
    });
  }

  // ── Response ────────────────────────────────────────────────────────────
  return res.json({
    inputs: {
      product_id: productId,
      product_name: productName,
      variant_id: variantId,
      variant_label: variantLabel,
      price_source: priceSource,
      list_price: listPrice,
      cost_price: costLyd,
      cost_usd: costUsd,
      coupon_code: body.coupon_code ?? null,
      simulate_referred: body.simulate_referred === true,
    },
    config: {
      usd_to_lyd: config.usdToLyd,
      markup_percent: config.markupPercent,
      max_total_discount_pct: config.maxTotalDiscountPct,
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
      trigger: "first approved topup (all channels, R115 policy B)",
    },
    margins: {
      gross_lyd: grossLyd,
      gross_pct: grossPct,
      net_lyd: netLyd,
      net_pct: netPct,
      referral_adjusted_lyd: refLyd,
      referral_adjusted_pct: refPct,
    },
    worst_case: {
      description: "deepest allowed stack: active flash + coupon up to the cap",
      combined_discount_pct: capPct,
      price: worstCasePrice,
      gross_lyd: worstCaseGross,
      contribution_lyd: worstCaseContribution,
      referred_contribution_lyd: worstCaseReferred,
    },
    guardrails: {
      break_even_price: breakEvenPrice,
      safe_min_price_incl_program: safeMinPrice,
      max_safe_discount_pct: maxSafeDiscountPct,
    },
    risk_state: riskState,
    warnings,
  });
});

export { router as adminPricingCalculatorRouter };
