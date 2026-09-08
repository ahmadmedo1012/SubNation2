import { db, flashSalesTable } from "@workspace/db";
import { and, eq, lt } from "drizzle-orm";
import { logAdminAlert } from "./alertLogger";
import { logger } from "../lib/logger";
import { captureSchedulerFailure } from "../lib/sentry";

/** Handle returned by startFlashSaleWatcher (B7-P2-11: stoppable + re-entry safe). */
export interface FlashSaleWatcherHandle {
  /** Idempotent: stops the interval + initial timeout. */
  stop: () => void;
}

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
// B7-P2-11: re-entry guard — a hung query must not stack concurrent runs.
let checkInFlight = false;

async function runDeactivateExpiredFlashSales(): Promise<void> {
  if (checkInFlight) {
    logger.warn("[flashSaleWatcher] previous check still in flight — skipping tick");
    return;
  }
  checkInFlight = true;
  try {
    await deactivateExpiredFlashSales();
  } finally {
    checkInFlight = false;
  }
}

async function deactivateExpiredFlashSales(): Promise<void> {
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
      "Flash-sale watcher: auto-deactivated expired rows",
    );
  } catch (err) {
    logger.error({ err }, "Flash-sale watcher error");
    captureSchedulerFailure("flash_sale_watcher", err);
  }
}

let running = false;
let stopCurrent: (() => void) | null = null;

export function startFlashSaleWatcher(): FlashSaleWatcherHandle {
  if (running) {
    logger.warn("[flashSaleWatcher] already running — ignoring re-start");
    return { stop: () => stopCurrent?.() };
  }
  running = true;
  // Initial pass after the same 30s grace as couponWatcher.
  const initial = setTimeout(() => void runDeactivateExpiredFlashSales(), 30_000);
  // Then every 5 minutes — short enough that operators rarely see a
  // freshly-expired row in the admin list, long enough that the load
  // is negligible (single UPDATE per 5-min window, usually 0 rows).
  const interval = setInterval(() => void runDeactivateExpiredFlashSales(), 5 * 60 * 1000);
  // B7-P2-11: timers must not keep the process alive on their own.
  initial.unref?.();
  interval.unref?.();

  stopCurrent = () => {
    clearTimeout(initial);
    clearInterval(interval);
    running = false;
    stopCurrent = null;
    logger.info("[flashSaleWatcher] stopped");
  };
  const stop = stopCurrent;
  logger.info("Flash-sale auto-deactivation watcher started");
  return { stop: () => stop() };
}
