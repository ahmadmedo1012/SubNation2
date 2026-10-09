import { db, inventoryTable, productsTable } from "@workspace/db";
import { eq, and, count } from "drizzle-orm";
import { notifyLowStock } from "../telegram";
import { logAdminAlert } from "./alertLogger";
import { logger } from "../lib/logger";
import { captureSchedulerFailure } from "../lib/sentry";

const LOW_STOCK_THRESHOLD = 3;

// Track which products we already alerted about this session
const alertedLow = new Set<number>();
const alertedZero = new Set<number>();

/**
 * Test seam: clear the in-memory per-session Sets to simulate a cold
 * restart — the DB-level dedupeKey is then the only guard left, which is
 * exactly what the A6-P2-1 notify-gating tests pin (same pattern as
 * couponWatcher's resetCouponWatcherMemoryForTests).
 */
export function resetStockWatcherMemoryForTests(): void {
  alertedLow.clear();
  alertedZero.clear();
}

/**
 * Low/zero-stock alert sweep — OPPORTUNISTIC since the 2026-09-20
 * free-infrastructure round (was: a 30-minute interval timer).
 *
 * Inventory only ever changes through: a purchase (checkout), a
 * refund, or an admin inventory write. Those are exactly the events
 * that trigger this sweep now (throttled 10 min), plus the leader
 * boot one-shot (web-scheduler.ts) as catch-up. No timer.
 */
async function checkLowStock(): Promise<void> {
  try {
    const products = await db
      .select({ id: productsTable.id, name: productsTable.name })
      .from(productsTable)
      .where(and(eq(productsTable.isActive, true), eq(productsTable.isArchived, false)));

    // One grouped COUNT for the whole catalog instead of a per-product
    // query (N+1 — this runs every 30 minutes under the scheduler lock).
    const stockRows = await db
      .select({ productId: inventoryTable.productId, count: count() })
      .from(inventoryTable)
      .where(eq(inventoryTable.isSold, false))
      .groupBy(inventoryTable.productId);
    const stockMap = new Map(stockRows.map((r) => [r.productId, Number(r.count)]));

    for (const product of products) {
      const stock = stockMap.get(product.id) ?? 0;

      if (stock === 0 && !alertedZero.has(product.id)) {
        // A6-P2-1 (round-93): log FIRST, notify SECOND. notifyLowStock
        // used to fire before the dedupe check, so every cold start
        // re-pinged the operator's phone for each permanently-out-of-
        // stock product even while the drawer insert was correctly
        // suppressed (~6 Telegram messages per deploy). All notification
        // channels now gate on the dedupe outcome.
        // Round-5: dedupeKey survives process restarts — the in-memory
        // Set below resets on every Render cold start, which is what
        // flooded the admin drawer with 244 duplicate no_stock alerts.
        const outcome = await logAdminAlert(
          "no_stock",
          `نفاد المخزون: ${product.name}`,
          `المخزون وصل إلى صفر وحدات`,
          { dedupeKey: `stock:zero:${product.id}` },
        );
        if (!outcome.suppressed) {
          notifyLowStock({ productName: product.name, stockCount: 0, productId: product.id });
        }
        alertedZero.add(product.id);
        alertedLow.delete(product.id);
        logger.info({ productId: product.id, productName: product.name }, "Zero stock alert sent");
      } else if (stock > 0 && stock <= LOW_STOCK_THRESHOLD && !alertedLow.has(product.id)) {
        // A6-P2-1 (round-93): same notify-gating as the zero-stock branch.
        const outcome = await logAdminAlert(
          "low_stock",
          `مخزون منخفض: ${product.name}`,
          `تبقّى ${stock} وحدة فقط`,
          { dedupeKey: `stock:low:${product.id}` },
        );
        if (!outcome.suppressed) {
          notifyLowStock({ productName: product.name, stockCount: stock, productId: product.id });
        }
        alertedLow.add(product.id);
        alertedZero.delete(product.id);
        logger.info(
          { productId: product.id, productName: product.name, stock },
          "Low stock alert sent",
        );
      } else if (stock > LOW_STOCK_THRESHOLD) {
        // Stock recovered — clear alerts so future drops trigger again
        alertedLow.delete(product.id);
        alertedZero.delete(product.id);
      }
    }
  } catch (err) {
    logger.error({ err }, "Stock watcher error");
    captureSchedulerFailure("stock_watcher", err);
  }
}

/**
 * Test seam: export the single-pass check so the A6-P2-1 notify-gating
 * contract is pinnable without timers (mirrors couponWatcher's exported
 * checkExpiringCoupons). Errors are swallowed internally exactly like
 * the scheduled path — assertions read the DB + notify-mock state.
 */
export const checkLowStockForTests = checkLowStock;

/**
 * Event-driven entry point (2026-09-20): fire the stock sweep after a
 * real inventory-changing event. Callers route this through
 * lib/opportunistic.ts's throttle ("stock-sweep", 10 min) so bursts
 * of checkouts / refunds / admin writes collapse to one sweep.
 */
export const runStockSweep = checkLowStock;

/**
 * R102 (inventory truthfulness) — orphaned stock report.
 *
 * Unsold units under ARCHIVED products are stranded by design: the admin
 * products list filters is_archived=false, so their management routes
 * (/inventory, /set-count) are unreachable, and the stock sweep above
 * only walks active products — they neither sell nor alert, they just
 * sit (live evidence: 3 units under 2 archived TEST artifacts).
 *
 * This is a VISIBILITY sweep, deliberately NOT a reaper: units may hold
 * real (paid-for) credentials, and deleting data is an operator decision
 * (the alert text says exactly where to look). Fires as a boot one-shot
 * (leader start); the 24h dedupeKey keeps the drawer clean across
 * restarts.
 */
export async function reportOrphanInventory(): Promise<void> {
  try {
    // R125-I6 (A8 B-10) site note: products.is_archived IS a leading
    // predicate here (archived-products sweep, joined to is_sold=false) —
    // one of the three live queries the corrected V1-M27 docblock in
    // migrate.ts cites. No index wanted: the boolean is almost-always
    // false (~zero selectivity), the archived set is tiny, and the sweep
    // runs as a boot one-shot — a seq scan is the right shape.
    const rows = await db
      .select({
        productId: productsTable.id,
        name: productsTable.name,
        unsold: count(),
      })
      .from(inventoryTable)
      .innerJoin(productsTable, eq(productsTable.id, inventoryTable.productId))
      .where(and(eq(inventoryTable.isSold, false), eq(productsTable.isArchived, true)))
      .groupBy(productsTable.id, productsTable.name);

    if (rows.length === 0) return;

    const total = rows.reduce((acc, r) => acc + Number(r.unsold), 0);
    const listing = rows
      .map((r) => `${r.name} (#${r.productId}): ${Number(r.unsold)} وحدة`)
      .join(" · ");
    await logAdminAlert(
      "system",
      `مخزون يتيم تحت منتجات مؤرشفة: ${total} وحدة`,
      `توجد وحدات غير مباعة مرتبطة بمنتجات مؤرشفة — غير قابلة للبيع ولا تظهر في لوحة المنتجات: ${listing}. راجعها من قاعدة البيانات (جدول inventory) وقرر الحذف أو إعادة التفعيل يدويًا.`,
      { dedupeKey: "inventory:orphan-archived" },
    );
    logger.warn(
      { category: "inventory", products: rows.length, totalUnsold: total },
      "Orphan inventory detected: unsold units under archived products",
    );
  } catch (err) {
    logger.error({ err }, "Orphan inventory report failed");
    captureSchedulerFailure("orphan_inventory_report", err);
  }
}
