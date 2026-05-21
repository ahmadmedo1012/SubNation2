import { db, flashSalesTable } from "@workspace/db";
import { and, eq, lt } from "drizzle-orm";
import { logAdminAlert } from "./alertLogger";
import { logger } from "../lib/logger";
import { captureSchedulerFailure } from "../lib/sentry";

/**
 * Flash-sale auto-deactivator.
 *
 * Runtime queries already gate active sales on `is_active=true AND
 * ends_at>now()`, so an expired-but-still-flagged-active row is inert.
 * This watcher exists for two operator-side reasons:
 *
 *   1. The `uniq_flash_sales_active_singleton` partial unique index
 *      forbids creating a new active sale while ANY row still has
 *      is_active=true. Without auto-flipping expired rows, the
 *      operator cannot create the next sale until they manually
 *      deactivate the previous one — friction for no benefit.
 *
 *   2. Audit log + admin views read `is_active` directly. Stale
 *      "active" rows after expiry are confusing to the operator.
 *
 * Runs every 5 minutes. Idempotent — only flips rows where both
 * conditions hold, so concurrent instances cannot race destructively.
 */
async function deactivateExpiredFlashSales(): Promise<void> {
  const now = new Date();

  try {
    const expired = await db
      .select({ id: flashSalesTable.id, title: flashSalesTable.title, endsAt: flashSalesTable.endsAt })
      .from(flashSalesTable)
      .where(and(eq(flashSalesTable.isActive, true), lt(flashSalesTable.endsAt, now)));

    if (expired.length === 0) return;

    await db
      .update(flashSalesTable)
      .set({ isActive: false })
      .where(and(eq(flashSalesTable.isActive, true), lt(flashSalesTable.endsAt, now)));

    for (const row of expired) {
      await logAdminAlert(
        "flash_sale_expired",
        `انتهت تخفيضات: ${row.title}`,
        `تم إنهاء التخفيضات تلقائياً بعد انتهاء وقتها (${row.endsAt.toISOString()}).`,
      );
    }

    logger.info(
      { deactivated: expired.length, ids: expired.map((r) => r.id) },
      "Flash-sale watcher: auto-deactivated expired rows",
    );
  } catch (err) {
    logger.error({ err }, "Flash-sale watcher error");
    captureSchedulerFailure("flash_sale_watcher", err);
  }
}

export function startFlashSaleWatcher(): void {
  // Initial pass after the same 30s grace as couponWatcher.
  setTimeout(() => deactivateExpiredFlashSales(), 30_000);
  // Then every 5 minutes — short enough that operators rarely see a
  // freshly-expired row in the admin list, long enough that the load
  // is negligible (single UPDATE per 5-min window, usually 0 rows).
  setInterval(() => deactivateExpiredFlashSales(), 5 * 60 * 1000);
  logger.info("Flash-sale auto-deactivation watcher started");
}
