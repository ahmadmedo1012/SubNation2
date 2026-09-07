import { db, inventoryTable, productsTable } from "@workspace/db";
import { eq, and, count } from "drizzle-orm";
import { notifyLowStock } from "../telegram";
import { logAdminAlert } from "./alertLogger";
import { logger } from "../lib/logger";
import { captureSchedulerFailure } from "../lib/sentry";

/** Handle returned by startStockWatcher (B7-P2-11: stoppable + re-entry safe). */
export interface StockWatcherHandle {
  /** Idempotent: stops the interval + initial timeout. */
  stop: () => void;
}

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

// B7-P2-11: re-entry guard — a hung query must not stack concurrent runs;
// the next tick is skipped while one is still in flight.
let checkInFlight = false;

async function runCheckLowStock(): Promise<void> {
  if (checkInFlight) {
    logger.warn("[stockWatcher] previous check still in flight — skipping tick");
    return;
  }
  checkInFlight = true;
  try {
    await checkLowStock();
  } finally {
    checkInFlight = false;
  }
}

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

let running = false;
let stopCurrent: (() => void) | null = null;

export function startStockWatcher(): StockWatcherHandle {
  if (running) {
    logger.warn("[stockWatcher] already running — ignoring re-start");
    return { stop: () => stopCurrent?.() };
  }
  running = true;
  // Run after a short delay to let DB settle, then every 30 minutes
  const initial = setTimeout(() => void runCheckLowStock(), 60_000);
  const interval = setInterval(() => void runCheckLowStock(), 30 * 60 * 1000);
  // B7-P2-11: timers must not keep the process alive on their own.
  initial.unref?.();
  interval.unref?.();

  stopCurrent = () => {
    clearTimeout(initial);
    clearInterval(interval);
    running = false;
    stopCurrent = null;
    logger.info("[stockWatcher] stopped");
  };
  const stop = stopCurrent;
  logger.info("Stock watcher started");
  return { stop: () => stop() };
}
