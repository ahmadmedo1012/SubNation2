import { db, productVariantsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { bumpCatalogCache } from "../../lib/catalog-cache";
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
// R163: site-wide pricing changes move every displayed price.
import { notifyIndexNow } from "../../lib/indexnow";

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

// R123-E5 (A6 P3): no-store parity with the 98-F3 pattern — the pricing
// rule is the catalog's single source of truth; an operator reading it
// (or saving it) must never see a cached stale rule.
router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

// ── GET /pricing/config ────────────────────────────────────────────────────
router.get("/pricing/config", async (_req, res) => {
  const config = await getPricingConfig();
  return res.json({
    usd_to_lyd: config.usdToLyd,
    markup_percent: config.markupPercent,
    max_total_discount_pct: config.maxTotalDiscountPct,
  });
});

// ── PUT /pricing/config ────────────────────────────────────────────────────
router.put("/pricing/config", async (req, res) => {
  const body = (req.body ?? {}) as {
    usd_to_lyd?: number;
    markup_percent?: number;
    max_total_discount_pct?: number;
  };
  const patch: { usdToLyd?: number; markupPercent?: number; maxTotalDiscountPct?: number } = {};
  if (body.usd_to_lyd !== undefined) patch.usdToLyd = round2(Number(body.usd_to_lyd));
  if (body.markup_percent !== undefined) patch.markupPercent = round2(Number(body.markup_percent));
  if (body.max_total_discount_pct !== undefined)
    patch.maxTotalDiscountPct = round2(Number(body.max_total_discount_pct));

  if (Object.keys(patch).length === 0)
    return res.status(400).json(createErrorResponse("لا توجد تغييرات", ErrorCode.INVALID_DATA));

  try {
    const config = await savePricingConfig(patch);
    await writeAuditLog(req, "pricing.config.update", "pricing_config", null, {
      ...patch,
      effective: config,
    });
    bumpCatalogCache();
    // R163: the exchange-rate/markup config moves every price — home is
    // the catalog-rendering money page (per-PDP is the sitemap's job).
    notifyIndexNow("/");
    return res.json({
      usd_to_lyd: config.usdToLyd,
      markup_percent: config.markupPercent,
      max_total_discount_pct: config.maxTotalDiscountPct,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (
      message === "INVALID_USD_TO_LYD" ||
      message === "INVALID_MARKUP_PERCENT" ||
      message === "INVALID_MAX_TOTAL_DISCOUNT_PCT"
    ) {
      return res
        .status(400)
        .json(
          createErrorResponse(
            "قيمة خارج النطاق المسموح (سعر الصرف 0.1–1000، الهامش 0–10000%، سقف الخصم المجمّع 10–95%)",
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
  // R115 (Part 15): dry-run mode — preview the impact (counts + a
  // BEFORE→AFTER sample per variant) WITHOUT touching a single row. The
  // destructive confirm in the UI can finally show the operator what
  // they are about to approve.
  const dryRun = ["true", "1", "yes"].includes(
    String(req.query.dry_run ?? "")
      .trim()
      .toLowerCase(),
  );

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

  if (dryRun) {
    return res.json({
      dry_run: true,
      variants_drifted: changes.length,
      products_affected: new Set(changes.map((c) => c.productId)).size,
      sample: changes.slice(0, 25).map((c) => ({
        variant_id: c.id,
        product_id: c.productId,
        price_before: c.current,
        price_after: c.computed,
        delta: round2(c.computed - c.current),
      })),
      usd_to_lyd: config.usdToLyd,
      markup_percent: config.markupPercent,
      note: "معاينة فقط — لم يُعدّل أي سعر. أعد النداء بدون dry_run للتطبيق الفعلي.",
    });
  }

  let variantsUpdated = 0;
  // R115: per-variant BEFORE/AFTER values ride the audit row — the old
  // prices are unrecoverable after the bulk write; now the trail keeps
  // them (A5 P1-1: "one confirmed tap rewrites 263 prices with no record
  // of what they were").
  const appliedChanges: Array<{
    variant_id: number;
    before: number;
    after: number;
  }> = [];
  // R125-I6 (A8 B-3): the variant rewrite + the products.price refresh ride
  // ONE db.transaction. Previously a mid-loop failure (connection drop,
  // constraint) left k of N variants at the NEW prices while the rest
  // stayed old — the storefront serves MIN(active variant price) from that
  // mixed set until a retry self-healed via the drift filter
  // (shopper-visible intermediate state). Per-row outcomes are preserved
  // (same rows written, same RETURNING-driven counts).
  //
  // PERF #1 (R136): the per-variant sequential UPDATE loop is now a
  // set-based VALUES rewrite. The R125 comment here used to say "the
  // sequential round-trip shape is deliberately kept (a set-based VALUES
  // rewrite is a separate change)" — this IS that separate change: one
  // confirmed tap rewrites 263 prices = 263 sequential round trips
  // holding row locks + one of 8 pool clients; the same tap is now ONE
  // UPDATE ... FROM (VALUES ...) per ≤500-row chunk (probe-verified on
  // pglite: the per-row BEFORE UPDATE triggers still fire inside the
  // single statement, so the R125-I6 atomicity pins hold — a mid-chunk
  // row failure aborts the whole statement and the tx rolls back every
  // chunk before it). The audit row + bumpCatalogCache stay POST-commit —
  // neither may land (or advertise a fresh generation) for a rolled-back
  // recompute.
  const PRICE_REWRITE_CHUNK = 500;
  const productsUpdatedCount = await db.transaction(async (tx) => {
    const updatedIdSet = new Set<number>();
    for (let offset = 0; offset < changes.length; offset += PRICE_REWRITE_CHUNK) {
      const chunk = changes.slice(offset, offset + PRICE_REWRITE_CHUNK);
      const valuesList = sql.join(
        chunk.map((c) => sql`(${c.id}::int, ${String(c.computed)}::numeric)`),
        sql`, `,
      );
      const result = await tx.execute(sql`
        UPDATE product_variants AS v
        SET price_lyd = s.p
        FROM (VALUES ${valuesList}) AS s(id, p)
        WHERE v.id = s.id
        RETURNING v.id
      `);
      const rows =
        (result as unknown as { rows?: Array<{ id: number }> }).rows ??
        (result as unknown as Array<{ id: number }>) ??
        [];
      for (const row of rows) updatedIdSet.add(Number(row.id));
    }
    // Rows-affected honesty, identical to the old per-row RETURNING loop:
    // count (and audit) only the rows the statement actually touched, and
    // keep the audit's before/after trail in the drift-scan order.
    variantsUpdated = updatedIdSet.size;
    for (const c of changes) {
      if (updatedIdSet.has(c.id)) {
        appliedChanges.push({ variant_id: c.id, before: c.current, after: c.computed });
      }
    }

    // Refresh every product's display price (= MIN active variant price) in
    // ONE statement; products without variants keep their stored price.
    const productsUpdated = await tx.execute(sql`
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
    return Array.isArray(productsUpdated.rows) ? productsUpdated.rows.length : 0;
  });

  await writeAuditLog(req, "pricing.recompute", "pricing_config", null, {
    usd_to_lyd: config.usdToLyd,
    markup_percent: config.markupPercent,
    variants_updated: variantsUpdated,
    products_updated: productsUpdatedCount,
    changes: appliedChanges.slice(0, 100),
  });

  bumpCatalogCache();
  // R163: the bulk re-pricing pass rewrote variant prices catalog-wide.
  notifyIndexNow("/");
  return res.json({
    variants_updated: variantsUpdated,
    products_updated: productsUpdatedCount,
    usd_to_lyd: config.usdToLyd,
    markup_percent: config.markupPercent,
  });
});

export const adminPricingConfigRouter = router;
