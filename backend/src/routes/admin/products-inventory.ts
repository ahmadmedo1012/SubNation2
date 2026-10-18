/**
 * R163 (size-gate carve): the admin inventory SET-COUNT route moved
 * VERBATIM from routes/admin/products.ts (the growth-banned 967-line
 * tripwire — the R163 IndexNow + features[] arms pushed the file past
 * its pin). Mounted by products.ts at the exact position this route
 * used to occupy, so Express route order is byte-identical.
 */
import { and, asc, count, eq, inArray } from "drizzle-orm";
import { db, inventoryTable, productsTable } from "@workspace/db";
import { Router } from "express";
import { writeAuditLog } from "../../lib/audit";
import { notifyAdminStats } from "../../lib/socket";
import { intParam } from "../../lib/http";
import { logger } from "../../lib/logger";
import { requireAdmin } from "../../middlewares/requireAdmin";
import { ErrorCode, createErrorResponse } from "../../lib/errors";
import { fireThrottledMaintenance } from "../../lib/opportunistic";
import { runStockSweep } from "../../jobs/stockWatcher";
// R163: the trim can flip availability — the docs' IndexNow trigger.
import { notifyProductChanged } from "../../lib/indexnow";

const router = Router();

/**
 * POST /products/:id/inventory/set-count — {count: n}
 *
 * V4-P0 (contract audit 2026-09-06): the admin UI's InlineStockEdit has
 * called this endpoint since it was written — but no route existed, so
 * EVERY manual stock edit 404'd and surfaced a destructive toast.
 *
 * Semantics (honest stock):
 *   - count < unsold  → DELETE the surplus OLDEST unsold units (an
 *     unsold row is a real, unclaimed account — removing it is safe and
 *     reviewable in the audit log).
 *   - count > unsold  → REJECT. Stock cannot be fabricated: every unit
 *     delivers real credentials at purchase time. The operator must add
 *     actual inventory via the upload path (POST /products/:id/inventory).
 */
router.post("/products/:id/inventory/set-count", requireAdmin, async (req, res) => {
  const productId = intParam(req, "id");
  if (productId === null)
    return res.status(400).json(createErrorResponse("معرف غير صالح", ErrorCode.INVALID_DATA));

  const { count: target } = (req.body ?? {}) as { count?: unknown };
  if (typeof target !== "number" || !Number.isInteger(target) || target < 0 || target > 100_000) {
    return res
      .status(400)
      .json(
        createErrorResponse(
          "عدد الوحدات يجب أن يكون رقماً صحيحاً بين 0 و100000",
          ErrorCode.INVALID_DATA,
        ),
      );
  }

  // R163: slug + category ride along for the IndexNow notification.
  const [product] = await db
    .select({ id: productsTable.id, slug: productsTable.slug, category: productsTable.category })
    .from(productsTable)
    .where(eq(productsTable.id, productId))
    .limit(1);
  if (!product)
    return res.status(404).json(createErrorResponse("المنتج غير موجود", ErrorCode.NOT_FOUND));

  const [unsoldResult] = await db
    .select({ unsold: count() })
    .from(inventoryTable)
    .where(and(eq(inventoryTable.productId, productId), eq(inventoryTable.isSold, false)));
  const unsold = Number(unsoldResult?.unsold ?? 0);

  if (target > unsold) {
    return res
      .status(400)
      .json(
        createErrorResponse(
          "لا يمكن زيادة المخزون بإدخال رقم فقط — كل وحدة تحتاج بيانات حساب فعلية. استخدم «رفع مخزون» لإضافة الوحدات",
          ErrorCode.INVALID_DATA,
        ),
      );
  }

  const surplus = unsold - target;
  let removed = 0;
  if (surplus > 0) {
    // Oldest-first (lowest id) — the units that have sat the longest are
    // the least valuable to keep.
    //
    // R143 (L9-3): the trim is now a TRANSACTION and the DELETE re-asserts
    // `is_sold = false`. The checkout claim takes the SAME oldest-first
    // rows (manual.provider.ts's two ordered FOR UPDATE SKIP LOCKED pools),
    // so the old check-then-act DELETE could swallow a unit a buyer
    // claimed between the two statements — `orders.inventory_id` flipped
    // to NULL via ON DELETE SET NULL and the sold-at history row vanished.
    // The guarded predicate converges the race to the honest outcome: the
    // claimed unit survives, fewer rows are trimmed than requested, and
    // the audit log below records the ACTUAL removed count.
    removed = await db.transaction(async (tx) => {
      const oldest = await tx
        .select({ id: inventoryTable.id })
        .from(inventoryTable)
        .where(and(eq(inventoryTable.productId, productId), eq(inventoryTable.isSold, false)))
        .orderBy(asc(inventoryTable.id))
        .limit(surplus);
      const deleted = await tx
        .delete(inventoryTable)
        .where(
          and(
            inArray(
              inventoryTable.id,
              oldest.map((r) => r.id),
            ),
            // Re-assert the SELECT's condition at DELETE time — the
            // conditional-claim idiom (E-1 / manual.provider.ts).
            eq(inventoryTable.isSold, false),
          ),
        )
        .returning({ id: inventoryTable.id });
      return deleted.length;
    });
    if (removed < surplus) {
      logger.warn(
        { productId, requested: surplus, removed },
        "set-count trim: units were sold while trimming — trimmed the unsold remainder only",
      );
    }
  }

  void writeAuditLog(req, "product.inventory.set-count", "product", productId, {
    before: unsold,
    after: target,
    removed,
  });

  // R126-L4 (A4-B2): ONLY when surplus > 0 — a set-count that matched the
  // existing unsold count deleted nothing, so emitting a "stats moved"
  // event would be a false signal (the emit rides actual catalog change,
  // not mere API success). A real deletion moves available_stock /
  // unsold_rows on /api/admin/stats.
  if (surplus > 0) {
    notifyAdminStats("product-stock-set-count", {
      product_id: productId,
      removed: surplus,
    });
    // R163: a real trim can flip is_available true→false — the docs'
    // explicit availability-change IndexNow trigger.
    notifyProductChanged(product.slug ?? String(productId), product.category);
  }

  // 2026-09-20 (free-infrastructure round): admin inventory write —
  // trigger the low/zero-stock sweep (throttled 10 min; was a
  // 30-minute interval timer).
  fireThrottledMaintenance("stock-sweep", 10 * 60 * 1000, runStockSweep);

  return res.json({ success: true, product_id: productId, stock_count: target });
});

export { router as adminProductsInventoryRouter };
