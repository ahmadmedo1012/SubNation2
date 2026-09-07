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
        notifyLowStock({ productName: product.name, stockCount: 0, productId: product.id });
        // Round-5: dedupeKey survives process restarts — the in-memory
        // Set below resets on every Render cold start, which is what
        // flooded the admin drawer with 244 duplicate no_stock alerts.
        await logAdminAlert(
          "no_stock",
          `نفاد المخزون: ${product.name}`,
          `المخزون وصل إلى صفر وحدات`,
          { dedupeKey: `stock:zero:${product.id}` },
        );
        alertedZero.add(product.id);
        alertedLow.delete(product.id);
        logger.info({ productId: product.id, productName: product.name }, "Zero stock alert sent");
      } else if (stock > 0 && stock <= LOW_STOCK_THRESHOLD && !alertedLow.has(product.id)) {
        notifyLowStock({ productName: product.name, stockCount: stock, productId: product.id });
        await logAdminAlert(
          "low_stock",
          `مخزون منخفض: ${product.name}`,
          `تبقّى ${stock} وحدة فقط`,
          { dedupeKey: `stock:low:${product.id}` },
        );
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

export function startStockWatcher(): void {
  // Run after a short delay to let DB settle, then every 30 minutes
  setTimeout(() => checkLowStock(), 60_000);
  setInterval(() => checkLowStock(), 30 * 60 * 1000);
  logger.info("Stock watcher started");
}
