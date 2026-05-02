import { db, inventoryTable, productsTable } from "@workspace/db";
import { eq, and, count } from "drizzle-orm";
import { notifyLowStock, isTelegramConfigured } from "../telegram";
import { logger } from "../lib/logger";

const LOW_STOCK_THRESHOLD = 3;

// Track which products we already alerted about this session
const alertedLow = new Set<number>();
const alertedZero = new Set<number>();

async function checkLowStock(): Promise<void> {
  if (!isTelegramConfigured()) return;

  try {
    const products = await db
      .select({ id: productsTable.id, name: productsTable.name })
      .from(productsTable)
      .where(and(eq(productsTable.isActive, true), eq(productsTable.isArchived, false)));

    for (const product of products) {
      const [row] = await db
        .select({ count: count() })
        .from(inventoryTable)
        .where(and(eq(inventoryTable.productId, product.id), eq(inventoryTable.isSold, false)));

      const stock = Number(row?.count ?? 0);

      if (stock === 0 && !alertedZero.has(product.id)) {
        notifyLowStock(product.name, 0);
        alertedZero.add(product.id);
        alertedLow.delete(product.id); // reset so we re-alert if it goes low again later
        logger.info({ productId: product.id, productName: product.name }, "Zero stock alert sent");
      } else if (stock > 0 && stock <= LOW_STOCK_THRESHOLD && !alertedLow.has(product.id)) {
        notifyLowStock(product.name, stock);
        alertedLow.add(product.id);
        alertedZero.delete(product.id);
        logger.info({ productId: product.id, productName: product.name, stock }, "Low stock alert sent");
      } else if (stock > LOW_STOCK_THRESHOLD) {
        // Stock recovered — clear alerts so future drops trigger again
        alertedLow.delete(product.id);
        alertedZero.delete(product.id);
      }
    }
  } catch (err) {
    logger.error({ err }, "Stock watcher error");
  }
}

export function startStockWatcher(): void {
  // Run after a short delay to let DB settle, then every 30 minutes
  setTimeout(() => checkLowStock(), 60_000);
  setInterval(() => checkLowStock(), 30 * 60 * 1000);
  logger.info("Stock watcher started");
}
