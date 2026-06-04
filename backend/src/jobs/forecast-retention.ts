/**
 * Forecast retention + capture-rate measurement
 * (011-inventory-demand-forecast, T047).
 *
 * Three responsibilities:
 *   1. Purge `inventory_forecasts` rows older than 90 days (research §R-7).
 *   2. Reap orphaned `in_flight` runs older than 24h. The runner sets
 *      outcome explicitly; a stuck `in_flight` row indicates a worker
 *      crash. Mark them failure with reason='abandoned' (data-model §2.1).
 *   3. Compute the rolling 14-day capture rate (data-model §3 invariant 4)
 *      and write it back to the latest run row. When the rate < 0.5, set
 *      the Redis pause flag (SC-008 kill criterion).
 *
 * Runs daily at 03:30 UTC; lives next to `risk-retention.ts` so on-call
 * has one mental model across the audit/forecast retention jobs.
 */

import { db, inventoryForecastsTable, inventoryForecastRunsTable } from "@workspace/db";
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { pauseAlerting } from "../lib/forecast/redis-flags";
import { setCaptureRate } from "../services/forecast/run-store";

export interface RetentionResult {
  forecastsDeleted: number;
  runsReaped: number;
  captureRate14d: number | null;
  alertsPaused: boolean;
}

const PAUSE_THRESHOLD = 0.5;

export async function runForecastRetention(): Promise<RetentionResult> {
  // 1. Purge forecasts older than 90 days.
  const purgeResult = await db
    .delete(inventoryForecastsTable)
    .where(sql`${inventoryForecastsTable.forecastDate} < CURRENT_DATE - INTERVAL '90 days'`);
  const forecastsDeleted =
    (purgeResult as unknown as { rowCount?: number }).rowCount ??
    (purgeResult as unknown as Array<unknown>).length ??
    0;

  // 2. Reap orphaned in_flight runs older than 24 hours.
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const reapResult = await db
    .update(inventoryForecastRunsTable)
    .set({
      outcome: "failure",
      completedAt: new Date(),
      failureReason: "abandoned: in_flight > 24h",
    })
    .where(
      and(
        eq(inventoryForecastRunsTable.outcome, "in_flight"),
        lt(inventoryForecastRunsTable.startedAt, cutoff),
        isNull(inventoryForecastRunsTable.completedAt),
      ),
    );
  const runsReaped =
    (reapResult as unknown as { rowCount?: number }).rowCount ??
    (reapResult as unknown as Array<unknown>).length ??
    0;

  // 3. Capture-rate analysis + kill-criterion check.
  const captureRate14d = await computeCaptureRate14d();
  let alertsPaused = false;

  const [latest] = await db
    .select({ id: inventoryForecastRunsTable.id })
    .from(inventoryForecastRunsTable)
    .where(eq(inventoryForecastRunsTable.outcome, "success"))
    .orderBy(sql`${inventoryForecastRunsTable.completedAt} DESC NULLS LAST`)
    .limit(1);
  if (latest) {
    await setCaptureRate(latest.id, captureRate14d);
  }

  if (captureRate14d !== null && captureRate14d < PAUSE_THRESHOLD) {
    await pauseAlerting(`capture_rate_below_threshold:${captureRate14d.toFixed(3)}`);
    alertsPaused = true;
    logger.warn(
      { category: "forecast.retention", captureRate14d },
      "[forecast-retention] capture rate < 0.5 — alerts paused (SC-008)",
    );
  }

  if (forecastsDeleted + runsReaped > 0 || captureRate14d !== null) {
    logger.info(
      { category: "forecast.retention", forecastsDeleted, runsReaped, captureRate14d },
      "[forecast-retention] purge + reap + capture-rate complete",
    );
  }

  return { forecastsDeleted, runsReaped, captureRate14d, alertsPaused };
}

async function computeCaptureRate14d(): Promise<number | null> {
  const result = await db.execute(sql`
    WITH actual_stockouts AS (
      SELECT p.id AS product_id
      FROM products p
      LEFT JOIN inventory i ON i.product_id = p.id AND i.is_sold = false
      WHERE p.is_archived = false AND p.is_active = true
      GROUP BY p.id
      HAVING COUNT(i.id) = 0
    ),
    captured AS (
      SELECT DISTINCT s.product_id
      FROM actual_stockouts s
      JOIN inventory_forecasts f ON f.product_id = s.product_id
      WHERE f.at_risk = true
        AND f.confidence IN ('high', 'medium')
        AND f.forecast_date >= CURRENT_DATE - INTERVAL '14 days'
        AND f.predicted_runout_at IS NOT NULL
        AND f.predicted_runout_at <= f.forecast_date + INTERVAL '3 days'
    )
    SELECT
      (SELECT COUNT(*) FROM actual_stockouts)::int AS total,
      (SELECT COUNT(*) FROM captured)::int AS captured;
  `);
  type Row = { total: number; captured: number };
  const r = result as unknown as { rows?: Row[] } | Row[];
  const rows = Array.isArray(r) ? r : (r.rows ?? []);
  const row = rows[0];
  if (!row || Number(row.total) === 0) return null;
  return Number(row.captured) / Number(row.total);
}
