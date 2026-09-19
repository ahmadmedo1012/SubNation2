import { db, flashSalesTable } from "@workspace/db";
import { and, eq, lt } from "drizzle-orm";
import { logAdminAlert } from "./alertLogger";
import { logger } from "../lib/logger";
import { captureSchedulerFailure } from "../lib/sentry";

/**
 * Flash-sale auto-deactivator — OPPORTUNISTIC since the 2026-09-20
 * free-infrastructure round (was: a 5-minute interval timer).
 *
 * Runtime queries already gate active sales on `is_active=true AND
 * ends_at>now()`, so an expired-but-still-flagged-active row is inert.
 * The deactivation exists for two operator-side reasons:
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
 * TRIGGERS now (no timer): the public GET /api/flash-sale read
 * (throttled 10 min), the admin promotions panel (throttled 1 min),
 * and the leader boot catch-up in web-scheduler.ts. Idempotent — only
 * flips rows where both conditions hold, so concurrent triggers cannot
 * race destructively.
 */
export async function deactivateExpiredFlashSales(): Promise<void> {
  const now = new Date();

  try {
    const expired = await db
      .select({
        id: flashSalesTable.id,
        title: flashSalesTable.title,
        endsAt: flashSalesTable.endsAt,
      })
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
        // F5 (round-94 A6): the only logAdminAlert call without a dedupe
        // key — two concurrently-running instances (blue-green window,
        // unguarded leadership) read the same expired rows before either
        // UPDATE lands → duplicate alerts that resolveAlertsByDedupeKey
        // can never collapse afterwards. 7-day window: an expired sale
        // can never expire again, so one alert per sale is the truth.
        {
          dedupeKey: `flash_sale_expired:${row.id}`,
          dedupeWindowMs: 7 * 24 * 60 * 60 * 1000,
        },
      );
    }

    logger.info(
      { deactivated: expired.length, ids: expired.map((r) => r.id) },
      "Flash-sale sweep: auto-deactivated expired rows",
    );
  } catch (err) {
    logger.error({ err }, "Flash-sale sweep error");
    captureSchedulerFailure("flash_sale_watcher", err);
  }
}
