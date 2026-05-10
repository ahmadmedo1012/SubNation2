import cron from "node-cron";
import { db, inventoryTable, productsTable } from "@workspace/db";
import { count, eq, sql } from "drizzle-orm";
import { logAdminAlert } from "./alertLogger";
import { logger } from "../lib/logger";

export function initCronJobs() {
  // 1. Every day at midnight: Low Stock Alert
  cron.schedule("0 0 * * *", async () => {
    logger.info("Running Low Stock Alert job");
    try {
      const lowStockProducts = await db
        .select({
          id: productsTable.id,
          name: productsTable.name,
          stockCount: count(inventoryTable.id),
        })
        .from(productsTable)
        .leftJoin(
          inventoryTable,
          sql`${productsTable.id} = ${inventoryTable.productId} AND ${inventoryTable.isSold} = false`,
        )
        .where(eq(productsTable.isArchived, false))
        .groupBy(productsTable.id, productsTable.name)
        .having(sql`count(${inventoryTable.id}) < 5`);

      for (const p of lowStockProducts) {
        await logAdminAlert(
          "low_stock",
          `مخزون منخفض: ${p.name}`,
          `المنتج "${p.name}" يحتوي على ${p.stockCount} عناصر فقط في المخزون. يرجى إعادة التعبئة.`,
        );
      }
      logger.info({ count: lowStockProducts.length }, "Low Stock Alert job finished");
    } catch (err) {
      logger.error({ err }, "Error in Low Stock Alert job");
    }
  });

  // 2. Every hour: Health Check / Cleanup (Example)
  cron.schedule("0 * * * *", () => {
    logger.debug("Hourly cron heartbeat");
  });

  logger.info("Cron jobs initialized");
}
