import { db, ordersTable, productVariantsTable, productsTable } from "@workspace/db";
import { and, asc, count, eq, sql } from "drizzle-orm";
import { Router } from "express";
import { computeRetailLYD, getPricingConfig, round2 } from "../../lib/pricing-config";
import { intParam } from "../../lib/http";
import { writeAuditLog } from "../../lib/audit";
import { requireAdmin } from "../../middlewares/requireAdmin";
import { ErrorCode, createErrorResponse } from "../../lib/errors";

/**
 * Admin catalog-variant management (catalog reconstruction 2026-09-20).
 *
 * Routes (mounted under /api/admin):
 *   GET    /products/:id/variants               — list (incl. internal cost)
 *   POST   /products/:id/variants               — create (price via engine)
 *   PATCH  /products/:id/variants/:variantId    — update
 *   DELETE /products/:id/variants/:variantId    — delete (order-guarded)
 *
 * Security contract: EVERY response here is admin-context ONLY (requireAdmin
 * at mount). The DTO intentionally includes cost_price + sku — the internal
 * procurement data the public /api/products surface must never see. The
 * public variant projection lives in routes/products.ts (loadPublicVariants)
 * and is hand-maintained there for exactly this reason.
 */

const router = Router();

// AUD103-4-F13 (r103): no-store parity with the 98-F3 pattern —
// this surface carries variant rows (pricing, SKUs); an intermediary must never
// serve it from cache.
router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
router.use(requireAdmin);

/** Serialize one variant row for the admin UI (internal fields included). */
async function formatVariant(
  v: typeof productVariantsTable.$inferSelect,
): Promise<Record<string, unknown>> {
  const config = await getPricingConfig();
  const priceLyd = parseFloat(String(v.priceLyd));
  const costUsd = parseFloat(String(v.costPrice));
  return {
    id: v.id,
    product_id: v.productId,
    plan_label: v.planLabel?.trim() || null,
    duration_label: v.durationLabel?.trim() || null,
    duration_days: v.durationDays ?? null,
    cost_price: costUsd,
    price_lyd: priceLyd,
    computed_price_lyd: computeRetailLYD(costUsd, config),
    sku: v.sku ?? null,
    is_active: v.isActive,
    sort_order: v.sortOrder,
    created_at: v.createdAt?.toISOString(),
  };
}

/** Keep products.price = MIN(active variant price) after every mutation. */
async function refreshProductDisplayPrice(productId: number): Promise<void> {
  const [row] = await db
    .select({ minPrice: sql<string | null>`MIN(${productVariantsTable.priceLyd})` })
    .from(productVariantsTable)
    .where(
      and(eq(productVariantsTable.productId, productId), eq(productVariantsTable.isActive, true)),
    );
  // Only overwrite when the product HAS active variants — a product whose
  // variants are all deactivated keeps its last display price (legacy path).
  if (row?.minPrice != null) {
    await db
      .update(productsTable)
      .set({ price: String(row.minPrice) })
      .where(eq(productsTable.id, productId));
  }
}

interface VariantBody {
  plan_label?: string | null;
  duration_label?: string | null;
  duration_days?: number | null;
  cost_price?: number;
  price_lyd?: number | null;
  sku?: string | null;
  sort_order?: number;
  is_active?: boolean;
}

function normalizeLabels(body: VariantBody): {
  planLabel: string | null;
  durationLabel: string | null;
} {
  const plan = typeof body.plan_label === "string" ? body.plan_label.trim() : "";
  const duration = typeof body.duration_label === "string" ? body.duration_label.trim() : "";
  return {
    planLabel: plan.length > 0 ? plan.slice(0, 120) : null,
    durationLabel: duration.length > 0 ? duration.slice(0, 120) : null,
  };
}

// ── GET /products/:id/variants ─────────────────────────────────────────────
router.get("/products/:id/variants", async (req, res) => {
  const id = intParam(req, "id");
  if (id === null)
    return res.status(400).json(createErrorResponse("معرف غير صالح", ErrorCode.INVALID_DATA));

  const [product] = await db
    .select({ id: productsTable.id })
    .from(productsTable)
    .where(eq(productsTable.id, id))
    .limit(1);
  if (!product)
    return res.status(404).json(createErrorResponse("المنتج غير موجود", ErrorCode.NOT_FOUND));

  const variants = await db
    .select()
    .from(productVariantsTable)
    .where(eq(productVariantsTable.productId, id))
    .orderBy(asc(productVariantsTable.sortOrder), asc(productVariantsTable.priceLyd));

  return res.json(await Promise.all(variants.map(formatVariant)));
});

// ── POST /products/:id/variants ─────────────────────────────────────────────
router.post("/products/:id/variants", async (req, res) => {
  const id = intParam(req, "id");
  if (id === null)
    return res.status(400).json(createErrorResponse("معرف غير صالح", ErrorCode.INVALID_DATA));

  const [product] = await db
    .select({ id: productsTable.id })
    .from(productsTable)
    .where(eq(productsTable.id, id))
    .limit(1);
  if (!product)
    return res.status(404).json(createErrorResponse("المنتج غير موجود", ErrorCode.NOT_FOUND));

  const body: VariantBody = req.body ?? {};
  const costUsd = typeof body.cost_price === "number" ? round2(body.cost_price) : null;
  if (costUsd === null || costUsd < 0.01 || costUsd > 100_000)
    return res
      .status(400)
      .json(
        createErrorResponse("التكلفة بالدولار مطلوبة (0.01 - 100,000)", ErrorCode.INVALID_DATA),
      );

  const { planLabel, durationLabel } = normalizeLabels(body);
  if (!planLabel && !durationLabel)
    return res
      .status(400)
      .json(createErrorResponse("يجب تحديد اسم الباقة أو المدة على الأقل", ErrorCode.INVALID_DATA));

  // The pricing engine is the single source of truth: price always derives
  // from cost via the current rule unless an explicit override is provided
  // (recorded in the audit log).
  const config = await getPricingConfig();
  const computed = computeRetailLYD(costUsd, config);
  const priceLyd =
    typeof body.price_lyd === "number" && body.price_lyd >= 0.01 && body.price_lyd <= 1_000_000
      ? round2(body.price_lyd)
      : computed;

  // Empty-string labels are normalized to NULL before the uniqueness probe
  // (Postgres treats NULLs as distinct in UNIQUE — '' keeps dedup honest).
  const [dupe] = await db
    .select({ id: productVariantsTable.id })
    .from(productVariantsTable)
    .where(
      and(
        eq(productVariantsTable.productId, id),
        sql`${productVariantsTable.planLabel} IS NOT DISTINCT FROM ${planLabel}`,
        sql`${productVariantsTable.durationLabel} IS NOT DISTINCT FROM ${durationLabel}`,
      ),
    )
    .limit(1);
  if (dupe)
    return res
      .status(409)
      .json(createErrorResponse("هذه الباقة موجودة مسبقًا لنفس المنتج", ErrorCode.CONFLICT));

  const [created] = await db
    .insert(productVariantsTable)
    .values({
      productId: id,
      planLabel,
      durationLabel,
      durationDays:
        typeof body.duration_days === "number" && body.duration_days >= 0
          ? Math.round(body.duration_days)
          : null,
      costPrice: String(costUsd),
      priceLyd: String(priceLyd),
      sku: typeof body.sku === "string" && body.sku.trim() ? body.sku.trim().slice(0, 160) : null,
      isActive: body.is_active !== false,
      sortOrder:
        typeof body.sort_order === "number" && body.sort_order >= 0
          ? Math.round(body.sort_order)
          : 0,
    })
    .returning();

  await refreshProductDisplayPrice(id);
  await writeAuditLog(req, "product.variant.create", "product_variant", created.id, {
    productId: id,
    variantId: created.id,
    planLabel,
    durationLabel,
    costPrice: costUsd,
    priceLyd,
    priceOverride: priceLyd !== computed,
  });

  return res.status(201).json(await formatVariant(created));
});

// ── PATCH /products/:id/variants/:variantId ────────────────────────────────
router.patch("/products/:id/variants/:variantId", async (req, res) => {
  const id = intParam(req, "id");
  const variantId = intParam(req, "variantId");
  if (id === null || variantId === null)
    return res.status(400).json(createErrorResponse("معرف غير صالح", ErrorCode.INVALID_DATA));

  const [existing] = await db
    .select()
    .from(productVariantsTable)
    .where(and(eq(productVariantsTable.id, variantId), eq(productVariantsTable.productId, id)))
    .limit(1);
  if (!existing)
    return res.status(404).json(createErrorResponse("الباقة غير موجودة", ErrorCode.NOT_FOUND));

  const body: VariantBody = req.body ?? {};
  const updates: Partial<typeof productVariantsTable.$inferInsert> = {};

  if (body.plan_label !== undefined || body.duration_label !== undefined) {
    const merged = normalizeLabels({
      plan_label: body.plan_label !== undefined ? body.plan_label : existing.planLabel,
      duration_label:
        body.duration_label !== undefined ? body.duration_label : existing.durationLabel,
    });
    if (!merged.planLabel && !merged.durationLabel)
      return res
        .status(400)
        .json(
          createErrorResponse("يجب تحديد اسم الباقة أو المدة على الأقل", ErrorCode.INVALID_DATA),
        );
    updates.planLabel = merged.planLabel;
    updates.durationLabel = merged.durationLabel;

    // Uniqueness probe against the NEW label pair (excluding self).
    const [dupe] = await db
      .select({ id: productVariantsTable.id })
      .from(productVariantsTable)
      .where(
        and(
          eq(productVariantsTable.productId, id),
          sql`${productVariantsTable.id} <> ${variantId}`,
          sql`${productVariantsTable.planLabel} IS NOT DISTINCT FROM ${merged.planLabel}`,
          sql`${productVariantsTable.durationLabel} IS NOT DISTINCT FROM ${merged.durationLabel}`,
        ),
      )
      .limit(1);
    if (dupe)
      return res
        .status(409)
        .json(createErrorResponse("هذه الباقة موجودة مسبقًا لنفس المنتج", ErrorCode.CONFLICT));
  }

  let costUsd = parseFloat(String(existing.costPrice));
  if (typeof body.cost_price === "number") {
    if (body.cost_price < 0.01 || body.cost_price > 100_000)
      return res
        .status(400)
        .json(createErrorResponse("التكلفة غير صالحة (0.01 - 100,000)", ErrorCode.INVALID_DATA));
    costUsd = round2(body.cost_price);
    updates.costPrice = String(costUsd);
  }

  if (body.price_lyd !== undefined && typeof body.price_lyd === "number") {
    if (body.price_lyd < 0.01 || body.price_lyd > 1_000_000)
      return res
        .status(400)
        .json(createErrorResponse("السعر غير صالح (0.01 - 1,000,000)", ErrorCode.INVALID_DATA));
    updates.priceLyd = String(round2(body.price_lyd));
  } else if (updates.costPrice !== undefined) {
    // Cost changed without an explicit price override → recompute via the
    // engine (the default path; overrides are explicit and audited).
    const config = await getPricingConfig();
    updates.priceLyd = String(computeRetailLYD(costUsd, config));
  }

  if (body.duration_days !== undefined) {
    updates.durationDays =
      typeof body.duration_days === "number" && body.duration_days >= 0
        ? Math.round(body.duration_days)
        : null;
  }
  if (typeof body.sku === "string") {
    updates.sku = body.sku.trim() ? body.sku.trim().slice(0, 160) : null;
  }
  if (typeof body.sort_order === "number" && body.sort_order >= 0) {
    updates.sortOrder = Math.round(body.sort_order);
  }
  if (typeof body.is_active === "boolean") {
    updates.isActive = body.is_active;
  }

  const [updated] = await db
    .update(productVariantsTable)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(productVariantsTable.id, variantId))
    .returning();

  await refreshProductDisplayPrice(id);
  await writeAuditLog(req, "product.variant.update", "product_variant", variantId, {
    productId: id,
    variantId,
    updates: { ...updates },
  });

  return res.json(await formatVariant(updated));
});

// ── DELETE /products/:id/variants/:variantId ───────────────────────────────
router.delete("/products/:id/variants/:variantId", async (req, res) => {
  const id = intParam(req, "id");
  const variantId = intParam(req, "variantId");
  if (id === null || variantId === null)
    return res.status(400).json(createErrorResponse("معرف غير صالح", ErrorCode.INVALID_DATA));

  const [existing] = await db
    .select({ id: productVariantsTable.id })
    .from(productVariantsTable)
    .where(and(eq(productVariantsTable.id, variantId), eq(productVariantsTable.productId, id)))
    .limit(1);
  if (!existing)
    return res.status(404).json(createErrorResponse("الباقة غير موجودة", ErrorCode.NOT_FOUND));

  // Order-history guard: orders keep a historical variant_label copy, but
  // the FK is SET NULL — deleting a variant that REAL orders point at would
  // silently erase the reference. Force deactivate instead (the label copy
  // keeps displaying either way; the reference stays queryable).
  const [{ orderCount }] = await db
    .select({ orderCount: count() })
    .from(ordersTable)
    .where(eq(ordersTable.variantId, variantId));
  if (Number(orderCount) > 0) {
    return res
      .status(409)
      .json(
        createErrorResponse(
          "لا يمكن حذف باقة مرتبطة بطلبات سابقة. عطّلها بدلاً من ذلك.",
          ErrorCode.CONFLICT,
        ),
      );
  }

  await db.delete(productVariantsTable).where(eq(productVariantsTable.id, variantId));
  await refreshProductDisplayPrice(id);
  await writeAuditLog(req, "product.variant.delete", "product_variant", variantId, {
    productId: id,
  });

  return res.json({ success: true, message: "تم حذف الباقة" });
});

export const adminProductVariantsRouter = router;
