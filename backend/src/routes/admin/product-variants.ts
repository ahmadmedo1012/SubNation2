import { db, ordersTable, productVariantsTable, productsTable } from "@workspace/db";
import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import { bumpCatalogCache } from "../../lib/catalog-cache";
import { Router } from "express";
import { computeRetailLYD, getPricingConfig, round2 } from "../../lib/pricing-config";
import { intParam } from "../../lib/http";
import { writeAuditLog } from "../../lib/audit";
// R167 (B3): the R162 cross-duration tier-price validator — warn-first
// advisory on the write path below (see the R167 block above the helper).
import { findTierPriceAnomalies, type TierPriceAnomaly } from "../../lib/catalog-quality";
import { logger } from "../../lib/logger";
import { isUniqueViolation } from "../../lib/pg-errors";
import { notifyAdminStats } from "../../lib/socket";
import { requireAdmin } from "../../middlewares/requireAdmin";
import { ErrorCode, createErrorResponse } from "../../lib/errors";
// R163: price-affecting variant CRUD is a documented IndexNow trigger.
import { notifyIndexNow } from "../../lib/indexnow";

/**
 * Admin catalog-variant management (catalog reconstruction 2026-09-20).
 *
 * Routes (mounted under /api/admin):
 *   GET    /products/tier-price-sweep              — whole-catalog audit (R168)
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

/**
 * F8 (R136 security scan): duration_days and sort_order are int4 columns
 * (`product_variants.duration_days` / `sort_order`) — the handlers below
 * accepted any number ≥ 0 (Math.round, no ceiling), so a value above
 * 2,147,483,647 overflowed the column and surfaced as 22001 → 500 on a
 * money-adjacent admin surface. The ceilings below mirror the
 * money-field bounds discipline already on this route (cost 0.01–100,000
 * / price 0.01–1,000,000): far above any real catalog intent (a 274-year
 * plan or a 10,000-deep sort lane is junk input, not a variant).
 */
const DURATION_DAYS_MAX = 100_000;
const SORT_ORDER_MAX = 10_000;

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

/** Keep products.price = MIN(active variant price) after every mutation.
 * R188-2 (C-F5): takes the caller's client (tx-compatible — the
 * insertLedgerEntry `tx as unknown as typeof db` idiom) so the create/patch
 * writes below can commit the refresh in the SAME transaction; callers that
 * stay autocommit (delete) keep the default client. */
async function refreshProductDisplayPrice(
  productId: number,
  client: typeof db = db,
): Promise<void> {
  const [row] = await client
    .select({ minPrice: sql<string | null>`MIN(${productVariantsTable.priceLyd})` })
    .from(productVariantsTable)
    .where(
      and(eq(productVariantsTable.productId, productId), eq(productVariantsTable.isActive, true)),
    );
  // Only overwrite when the product HAS active variants — a product whose
  // variants are all deactivated keeps its last display price (legacy path).
  if (row?.minPrice != null) {
    await client
      .update(productsTable)
      .set({ price: String(row.minPrice) })
      .where(eq(productsTable.id, productId));
  }
}

// ── R167 (B3): warn-first tier-price sweep on the variant write path ───────
//
// PRODUCT DECISION (coordinator, final — the only backend item deferred
// from R166): WARN-FIRST, ADDITIVE, NEVER BLOCKING. After a successful
// create/update the route re-runs the R162 cross-duration tier-price
// validator (lib/catalog-quality.ts — two plan labels ordered strictly at
// one shared duration must stay strictly ordered at every other shared
// duration; catches the live Ahrefs defect class: قياسي/متقدم equalized at
// سنوي) over the affected product's ACTIVE variant matrix. When the write
// leaves such an inconsistency behind, the SUCCESS response carries an
// additive `warnings` array (below) plus exactly one warn-level log line.
// A clean write carries NO warnings field at all — the additive contract.
//
// Why never blocking (the audit's risk note): a 4xx/5xx gate here would
// strand every product that ALREADY carries the defect class with no
// in-app remediation path — operators must be able to fix existing bad
// rows through this exact surface. Deactivating the offending row is the
// documented silencer: the sweep validates the ACTIVE matrix (the same
// projection the public storefront renders — catalog.service.ts
// fetchVariantPoolData), so hiding a row drops its warnings; the write
// itself always succeeds. Warnings are response payload, NOT error codes
// (shared/error-codes and the parity gates stay untouched).

/** One additive response warning item — see the R167 block above. */
interface VariantWriteWarning {
  /** The validator finding class — mirrors TierPriceAnomaly.kind. */
  kind: "equalized" | "inverted";
  /** Operator-facing Arabic copy, ready for a toast as-is. */
  message: string;
}

/**
 * R168 (L2): the trim/parseFloat projection BOTH tier-price consumers
 * (the R167 write-path sweep + the whole-catalog audit below) feed
 * findTierPriceAnomalies — one copy of the ACTIVE-matrix preparation.
 */
function activeVariantPricePoints(
  rows: Array<{ planLabel: string | null; durationLabel: string | null; priceLyd: string }>,
) {
  return rows.map((v) => ({
    plan_label: v.planLabel?.trim() || null,
    duration_label: v.durationLabel?.trim() || null,
    price: parseFloat(String(v.priceLyd)),
  }));
}

// R167: en-US grouping + 2 decimals — the site's money numeral language
// (mirrors the frontend formatCurrency CURRENCY_NUMBER_FORMATTER contract).
const LYD_COPY_FORMATTER = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** R167: map one validator finding to the operator-facing Arabic copy. */
function tierPriceWarningMessage(a: TierPriceAnomaly): string {
  const duration = a.duration ?? "بدون مدة";
  if (a.kind === "equalized") {
    return `تحذير: سعر الباقتين «${a.planA}» و«${a.planB}» متساوٍ (${LYD_COPY_FORMATTER.format(
      a.price,
    )} د.ل) عند مدة «${duration}» رغم اختلاف ترتيب سعرهما عند المدد الأخرى للمنتج نفسه — تحقّق من صحة الأسعار.`;
  }
  return `تحذير: ترتيب سعر الباقتين «${a.planA}» و«${a.planB}» معكوس عند مدة «${duration}» («${
    a.planA
  }» بسعر ${LYD_COPY_FORMATTER.format(a.priceA)} د.ل و«${a.planB}» بسعر ${LYD_COPY_FORMATTER.format(
    a.priceB,
  )} د.ل) خلافًا لترتيبهما عند المدد الأخرى للمنتج نفسه — تحقّق من صحة الأسعار.`;
}

/**
 * R167 (B3): re-run the R162 validator over the product's ACTIVE variant
 * matrix after a successful create/update and map findings to response
 * warnings. Defensive by contract: ANY failure (the DB read or the
 * validator itself) degrades to one logged warn line and an empty array —
 * the write has already committed, so the sweep must never 5xx the request.
 */
async function collectTierPriceWarnings(
  productId: number,
  variantId: number,
): Promise<VariantWriteWarning[]> {
  try {
    const rows = await db
      .select({
        planLabel: productVariantsTable.planLabel,
        durationLabel: productVariantsTable.durationLabel,
        priceLyd: productVariantsTable.priceLyd,
      })
      .from(productVariantsTable)
      .where(
        and(eq(productVariantsTable.productId, productId), eq(productVariantsTable.isActive, true)),
      )
      // Same order as the public projection (catalog.service.ts) — keeps
      // the anchor-duration pick deterministic for pathological matrices.
      .orderBy(asc(productVariantsTable.sortOrder), asc(productVariantsTable.priceLyd));
    const anomalies = findTierPriceAnomalies(activeVariantPricePoints(rows));
    if (anomalies.length === 0) return [];
    // R167: exactly ONE warn-level line per offending write (repo idiom).
    logger.warn(
      { productId, variantId, anomalies },
      "tier-price anomaly left behind by admin variant write (warn-first, never blocking)",
    );
    return anomalies.map((a) => ({ kind: a.kind, message: tierPriceWarningMessage(a) }));
  } catch (err) {
    logger.warn(
      { err, productId, variantId },
      "tier-price anomaly sweep failed (non-fatal — the variant write stays committed)",
    );
    return [];
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

// ── GET /products/tier-price-sweep ────────────────────────────────────────
// R168 (L2): the whole-catalog READ-ONLY twin of the R167 write-path
// sweep — every active, non-archived product's ACTIVE variant matrix
// through the same R162 validator, mapped to the same operator copy
// (tierPriceWarningMessage — one copy registry) plus the variant evidence
// an operator needs to correct the row. Path note: a literal 2-segment
// /products/* path — no collision with the :id routes (3+ segments) in
// either router sharing the /products family, and GET-only here.
// READ-ONLY by construction: no writes, no bumpCatalogCache, no
// notifyIndexNow, no audit log (it observes; it can never mutate).
router.get("/products/tier-price-sweep", async (_req, res, next) => {
  try {
    // The catalog is small (~60 products) — single scan, no pagination;
    // the defensive cap mirrors diagnostics' inventory-health echo.
    const SCAN_CAP = 1_000;
    const products = await db
      .select({ id: productsTable.id, name: productsTable.name, slug: productsTable.slug })
      .from(productsTable)
      .where(and(eq(productsTable.isActive, true), eq(productsTable.isArchived, false)))
      .orderBy(asc(productsTable.id))
      .limit(SCAN_CAP);

    const productIds = products.map((p) => p.id);
    // One inArray query over the whole catalog (the admin products list
    // idiom) — ACTIVE variants only, ordered like collectTierPriceWarnings.
    const variantRows =
      productIds.length > 0
        ? await db
            .select({
              id: productVariantsTable.id,
              productId: productVariantsTable.productId,
              planLabel: productVariantsTable.planLabel,
              durationLabel: productVariantsTable.durationLabel,
              priceLyd: productVariantsTable.priceLyd,
            })
            .from(productVariantsTable)
            .where(
              and(
                inArray(productVariantsTable.productId, productIds),
                eq(productVariantsTable.isActive, true),
              ),
            )
            .orderBy(asc(productVariantsTable.sortOrder), asc(productVariantsTable.priceLyd))
        : [];

    const rowsByProduct = new Map<number, typeof variantRows>();
    for (const v of variantRows) {
      const list = rowsByProduct.get(v.productId) ?? [];
      list.push(v);
      rowsByProduct.set(v.productId, list);
    }

    const findings: Array<Record<string, unknown>> = [];
    let productsWithFindings = 0;
    for (const p of products) {
      const rows = rowsByProduct.get(p.id) ?? [];
      const anomalies = findTierPriceAnomalies(activeVariantPricePoints(rows));
      if (anomalies.length === 0) continue;
      productsWithFindings += 1;
      for (const a of anomalies) {
        findings.push({
          product_id: p.id,
          product_name: p.name,
          product_slug: p.slug,
          kind: a.kind,
          plan_a: a.planA,
          plan_b: a.planB,
          duration: a.duration,
          ...(a.kind === "equalized"
            ? { price: a.price }
            : { price_a: a.priceA, price_b: a.priceB }),
          message: tierPriceWarningMessage(a),
          variants: rows.map((v) => ({
            id: v.id,
            plan_label: v.planLabel?.trim() || null,
            duration_label: v.durationLabel?.trim() || null,
            price: parseFloat(String(v.priceLyd)),
          })),
        });
      }
    }

    return res.json({
      checked_at: new Date().toISOString(),
      products_scanned: products.length,
      variants_scanned: variantRows.length,
      scan_cap: SCAN_CAP,
      products_with_findings: productsWithFindings,
      findings,
    });
  } catch (err) {
    return next(err);
  }
});

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

  // F8 (R136): int4 ceilings — see DURATION_DAYS_MAX / SORT_ORDER_MAX above.
  // Only the overflow is refused; the existing ≥ 0 coercion semantics for
  // lower junk (null / default) are untouched.
  if (typeof body.duration_days === "number" && body.duration_days > DURATION_DAYS_MAX) {
    return res
      .status(400)
      .json(
        createErrorResponse("مدة الصلاحية غير صالحة (0 - 100,000 يوم)", ErrorCode.INVALID_DATA),
      );
  }
  if (typeof body.sort_order === "number" && body.sort_order > SORT_ORDER_MAX) {
    return res
      .status(400)
      .json(createErrorResponse("ترتيب العرض غير صالح (0 - 10,000)", ErrorCode.INVALID_DATA));
  }

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

  // R188-2 (C-F5): the variant write + the display-price refresh were two
  // autocommit writes — a crash between them left products.price stale vs
  // MIN(active variant price) until the next write (the R125-I6 mixed-state
  // class, fixed for the recompute endpoint but never extended here). One
  // transaction now commits both.
  // R188-2 (C-F7): the probe above is check-then-act;
  // uniq_product_variants_plan_duration is the live guard — the loser's
  // 23505 now maps to the probe's IDENTICAL 409 envelope (byte-identical
  // body) instead of a raw 500 on an admin surface.
  let created: typeof productVariantsTable.$inferSelect;
  try {
    created = await db.transaction(async (tx) => {
      const [row] = await tx
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
          sku:
            typeof body.sku === "string" && body.sku.trim() ? body.sku.trim().slice(0, 160) : null,
          isActive: body.is_active !== false,
          sortOrder:
            typeof body.sort_order === "number" && body.sort_order >= 0
              ? Math.round(body.sort_order)
              : 0,
        })
        .returning();
      await refreshProductDisplayPrice(id, tx as unknown as typeof db);
      return row;
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return res
        .status(409)
        .json(createErrorResponse("هذه الباقة موجودة مسبقًا لنفس المنتج", ErrorCode.CONFLICT));
    }
    throw err;
  }

  await writeAuditLog(req, "product.variant.create", "product_variant", created.id, {
    productId: id,
    variantId: created.id,
    planLabel,
    durationLabel,
    costPrice: costUsd,
    priceLyd,
    priceOverride: priceLyd !== computed,
  });

  // R126-L4 (A4-B2): the products-family admin-stats-update emit — variant
  // mutations refresh the parent product's display price (and can flip its
  // active set), moving catalog stats (lowest_price / available_products).
  // Same fire-and-forget idiom as orders.ts. R158: carried by the shared
  // notifyAdminStats helper (lib/socket.ts).
  notifyAdminStats("product-variant-create", {
    product_id: id,
    variant_id: created.id,
  });

  bumpCatalogCache();
  // R163: a new price-bearing variant changes the PDP's rendered offers —
  // ping it (numeric-id URL; its shell canonicalizes to the slug form, so
  // the engine consolidates onto the sitemap URL).
  notifyIndexNow(`/product/${id}`);

  // R167 (B3): warn-first sweep AFTER the committed write — see
  // collectTierPriceWarnings' docblock; `warnings` rides the success body
  // only when the write left an anomaly behind (absent = clean).
  const warnings = await collectTierPriceWarnings(id, created.id);
  const payload = await formatVariant(created);
  return res.status(201).json(warnings.length > 0 ? { ...payload, warnings } : payload);
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
    // F8 (R136): int4 ceiling — see DURATION_DAYS_MAX above.
    if (typeof body.duration_days === "number" && body.duration_days > DURATION_DAYS_MAX) {
      return res
        .status(400)
        .json(
          createErrorResponse("مدة الصلاحية غير صالحة (0 - 100,000 يوم)", ErrorCode.INVALID_DATA),
        );
    }
    updates.durationDays =
      typeof body.duration_days === "number" && body.duration_days >= 0
        ? Math.round(body.duration_days)
        : null;
  }
  if (typeof body.sku === "string") {
    updates.sku = body.sku.trim() ? body.sku.trim().slice(0, 160) : null;
  }
  if (typeof body.sort_order === "number" && body.sort_order >= 0) {
    // F8 (R136): int4 ceiling — see SORT_ORDER_MAX above. Checked before
    // the Math.round so a 10,000.9 does not round under the radar.
    if (body.sort_order > SORT_ORDER_MAX) {
      return res
        .status(400)
        .json(createErrorResponse("ترتيب العرض غير صالح (0 - 10,000)", ErrorCode.INVALID_DATA));
    }
    updates.sortOrder = Math.round(body.sort_order);
  }
  if (typeof body.is_active === "boolean") {
    updates.isActive = body.is_active;
  }

  // R188-2 (C-F5): same one-transaction shape as the create branch — the
  // variant write and the display-price refresh commit together or not at
  // all. (No 23505 mapping here: the label-rename dupe race keeps today's
  // raw-error propagation — C-F7 scoped the create path only.)
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(productVariantsTable)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(productVariantsTable.id, variantId))
      .returning();
    await refreshProductDisplayPrice(id, tx as unknown as typeof db);
    return row;
  });

  await writeAuditLog(req, "product.variant.update", "product_variant", variantId, {
    productId: id,
    variantId,
    updates: { ...updates },
  });

  // R126-L4 (A4-B2): same emit class as create — price/is_active edits
  // move catalog stats via refreshProductDisplayPrice.
  notifyAdminStats("product-variant-update", {
    product_id: id,
    variant_id: variantId,
  });

  bumpCatalogCache();
  // R163: variant price/label edits change the PDP's rendered offer.
  notifyIndexNow(`/product/${id}`);

  // R167 (B3): same warn-first sweep as create — see the POST block above.
  const warnings = await collectTierPriceWarnings(id, variantId);
  const payload = await formatVariant(updated);
  return res.json(warnings.length > 0 ? { ...payload, warnings } : payload);
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

  // R126-L4 (A4-B2): same emit class as create/update — the delete also
  // reruns refreshProductDisplayPrice.
  notifyAdminStats("product-variant-delete", {
    product_id: id,
    variant_id: variantId,
  });

  bumpCatalogCache();
  // R163: deleting a variant changes the PDP's offer set.
  notifyIndexNow(`/product/${id}`);
  return res.json({ success: true, message: "تم حذف الباقة" });
});

export const adminProductVariantsRouter = router;
