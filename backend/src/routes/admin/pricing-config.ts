import { db, productVariantsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { Router } from "express";
import {
  computeRetailLYD,
  getPricingConfig,
  round2,
  savePricingConfig,
} from "../../lib/pricing-config";
import { writeAuditLog } from "../../lib/audit";
import { requireAdmin } from "../../middlewares/requireAdmin";
import { ErrorCode, createErrorResponse } from "../../lib/errors";

/**
 * Admin pricing configuration endpoints (catalog reconstruction 2026-09-20).
 *
 * Routes (mounted under /api/admin):
 *   GET  /pricing/config    — effective rule (rate + markup)
 *   PUT  /pricing/config    — override (bounded, audited)
 *   POST /pricing/recompute — recompute EVERY variant's price_lyd from cost
 *                             via the CURRENT rule + refresh display prices
 *
 * This is the operator's control surface for the single source of truth
 * (lib/pricing-config.ts): 1 USD = 10 LYD, markup 100% by default. A rule
 * change does NOT silently rewrite catalog prices — the operator reviews
 * then triggers the explicit recompute action ( audited, returns counts ).
 */

const router = Router();
router.use(requireAdmin);

// ── GET /pricing/config ────────────────────────────────────────────────────
router.get("/pricing/config", async (_req, res) => {
  const config = await getPricingConfig();
  return res.json({
    usd_to_lyd: config.usdToLyd,
    markup_percent: config.markupPercent,
  });
});

// ── PUT /pricing/config ────────────────────────────────────────────────────
router.put("/pricing/config", async (req, res) => {
  const body = (req.body ?? {}) as { usd_to_lyd?: number; markup_percent?: number };
  const patch: { usdToLyd?: number; markupPercent?: number } = {};
  if (body.usd_to_lyd !== undefined) patch.usdToLyd = round2(Number(body.usd_to_lyd));
  if (body.markup_percent !== undefined) patch.markupPercent = round2(Number(body.markup_percent));

  if (Object.keys(patch).length === 0)
    return res.status(400).json(createErrorResponse("لا توجد تغييرات", ErrorCode.INVALID_DATA));

  try {
    const config = await savePricingConfig(patch);
    await writeAuditLog(req, "pricing.config.update", "pricing_config", null, {
      ...patch,
      effective: config,
    });
    return res.json({
      usd_to_lyd: config.usdToLyd,
      markup_percent: config.markupPercent,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === "INVALID_USD_TO_LYD" || message === "INVALID_MARKUP_PERCENT") {
      return res
        .status(400)
        .json(
          createErrorResponse(
            "قيمة خارج النطاق المسموح (سعر الصرف 0.1–1000، الهامش 0–10000%)",
            ErrorCode.INVALID_DATA,
          ),
        );
    }
    throw err;
  }
});

// ── POST /pricing/recompute ────────────────────────────────────────────────
router.post("/pricing/recompute", async (req, res) => {
  const config = await getPricingConfig();

  // Recompute every ACTIVE variant whose stored price no longer matches the
  // engine output. Variant costs are untouched; only price_lyd moves — and
  // only for rows that actually drift (idempotent: re-running yields 0).
  const allVariants = await db
    .select({
      id: productVariantsTable.id,
      productId: productVariantsTable.productId,
      costPrice: productVariantsTable.costPrice,
      priceLyd: productVariantsTable.priceLyd,
    })
    .from(productVariantsTable)
    .where(eq(productVariantsTable.isActive, true));

  const changes = allVariants
    .map((v) => {
      const computed = computeRetailLYD(parseFloat(String(v.costPrice)), config);
      return {
        id: v.id,
        productId: v.productId,
        computed,
        current: parseFloat(String(v.priceLyd)),
      };
    })
    .filter((c) => c.computed !== c.current);

  let variantsUpdated = 0;
  for (const c of changes) {
    const [updated] = await db
      .update(productVariantsTable)
      .set({ priceLyd: String(c.computed) })
      .where(eq(productVariantsTable.id, c.id))
      .returning({ id: productVariantsTable.id });
    if (updated) variantsUpdated += 1;
  }

  // Refresh every product's display price (= MIN active variant price) in
  // ONE statement; products without variants keep their stored price.
  const productsUpdated = await db.execute(sql`
    UPDATE products p
    SET price = sub.min_price
    FROM (
      SELECT product_id, MIN(price_lyd) AS min_price
      FROM product_variants
      WHERE is_active = TRUE
      GROUP BY product_id
    ) AS sub
    WHERE p.id = sub.product_id
      AND p.price <> sub.min_price
    RETURNING p.id
  `);
  const productsUpdatedCount = Array.isArray(productsUpdated.rows)
    ? productsUpdated.rows.length
    : 0;

  await writeAuditLog(req, "pricing.recompute", "pricing_config", null, {
    usd_to_lyd: config.usdToLyd,
    markup_percent: config.markupPercent,
    variants_updated: variantsUpdated,
    products_updated: productsUpdatedCount,
  });

  return res.json({
    variants_updated: variantsUpdated,
    products_updated: productsUpdatedCount,
    usd_to_lyd: config.usdToLyd,
    markup_percent: config.markupPercent,
  });
});

export const adminPricingConfigRouter = router;
