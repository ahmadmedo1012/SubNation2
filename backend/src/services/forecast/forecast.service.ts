/**
 * Forecast orchestrator (011-inventory-demand-forecast, T026).
 *
 * The single entry point for the daily run. Composes:
 *   1. createInFlightRun()
 *   2. loadOrderHistoryForActiveProducts()  (one batched query)
 *   3. per-product math via the pure helpers in statistical.ts + reorder.ts
 *   4. upsert each forecast row via forecast-store
 *   5. dispatch alerts via alerts.ts (US3)
 *   6. markSuccess / markFailure on the run row
 *   7. write an audit_logs entry per FR-FORECAST-009
 *
 * Never throws — all internal failures are swallowed and surfaced via
 * `markFailure` + the metrics counters. FR-FORECAST-005 is enforced
 * at the caller (the cron is the only invoker; no synchronous request
 * path calls this).
 */

import { auditLogsTable, db } from "@workspace/db";
import { logger } from "../../lib/logger";
import {
  recordForecastRun,
  recordProductsPredicted,
  recordProductsSkipped,
  recordRunDuration,
} from "../../lib/forecast/metrics";
import { addDays, clampDate, todayUtcDate } from "../../lib/forecast/dates";
import { dispatchForecastAlerts } from "./alerts";
import { loadOrderHistoryForActiveProducts } from "./aggregate";
import { upsertForecast } from "./forecast-store";
import { recommendReorderQty } from "./reorder";
import {
  createInFlightRun,
  markFailure,
  markSuccess,
  type RunCounts,
} from "./run-store";
import {
  computeAvgDailySales,
  computeDowBlend7d,
  densifyHistory,
  deriveConfidence,
  predictDemand7d,
  predictDemand30d,
} from "./statistical";

const HISTORY_WINDOW_DAYS = 14;
const RUNOUT_HORIZON_DAYS = 90;
const AT_RISK_HORIZON_DAYS = 30;

export interface RunResult {
  runId: number | null;
  outcome: "success" | "failure" | "no_op";
  productsPredicted: number;
  productsSkipped: Record<string, number>;
  alertsEmitted: number;
  alertsCapped: boolean;
  durationSeconds: number;
}

export async function runForecast(): Promise<RunResult> {
  const startedAt = process.hrtime.bigint();
  let runId: number | null = null;
  const skipped: Record<string, number> = {};
  let predicted = 0;
  const forecastDate = todayUtcDate();
  const horizonHi = addDays(forecastDate, RUNOUT_HORIZON_DAYS);

  try {
    const run = await createInFlightRun({ workerTier: process.env.WORKER_TIER_ID ?? null });
    runId = run.id;

    const products = await loadOrderHistoryForActiveProducts();

    for (const p of products) {
      try {
        const denseHistory = densifyHistory(p.history, forecastDate, HISTORY_WINDOW_DAYS);
        const longHistory = densifyHistory(p.history, forecastDate, 28);
        const confidence = deriveConfidence(denseHistory);

        if (confidence === "insufficient_data") {
          skipped.insufficient_data = (skipped.insufficient_data ?? 0) + 1;
          await upsertForecast({
            runId: run.id,
            productId: p.productId,
            forecastDate,
            currentStockOnHand: p.currentStockOnHand,
            avgDailySales: null,
            dowBlend7d: null,
            predictedDemand7d: null,
            predictedDemand30d: null,
            predictedRunoutAt: null,
            recommendedReorderQty: null,
            confidence,
            atRisk: false,
          });
          continue;
        }

        const avg = computeAvgDailySales(denseHistory);
        const dowBlend = computeDowBlend7d(longHistory, forecastDate);
        const d7 = predictDemand7d(avg, dowBlend);
        const d30 = predictDemand30d(longHistory, forecastDate, avg);

        // Predicted runout: today + floor(stock / max(avg, 0.1)), clamped.
        const daysUntilRunout = Math.floor(p.currentStockOnHand / Math.max(avg, 0.1));
        const predictedRunoutAt = clampDate(
          addDays(forecastDate, daysUntilRunout),
          forecastDate,
          horizonHi,
        );

        const reorder = recommendReorderQty(d30, p.currentStockOnHand);

        const atRisk = predictedRunoutAt <= addDays(forecastDate, AT_RISK_HORIZON_DAYS);

        await upsertForecast({
          runId: run.id,
          productId: p.productId,
          forecastDate,
          currentStockOnHand: p.currentStockOnHand,
          avgDailySales: avg,
          dowBlend7d: dowBlend,
          predictedDemand7d: d7,
          predictedDemand30d: d30,
          predictedRunoutAt,
          recommendedReorderQty: reorder,
          confidence,
          atRisk,
        });
        predicted++;
      } catch (err) {
        skipped.error = (skipped.error ?? 0) + 1;
        logger.warn(
          { err, productId: p.productId, category: "forecast.run" },
          "[forecast] per-product failure (counted as error skip)",
        );
      }
    }

    // US3 — alert dispatch for the just-completed run.
    const alertResult = await dispatchForecastAlerts(run.id).catch((err) => {
      logger.warn({ err, runId: run.id, category: "forecast.run" }, "[forecast] alerts threw");
      return { alertsEmitted: 0, alertsCapped: false, paused: false };
    });

    const counts: RunCounts = {
      productsPredicted: predicted,
      productsSkipped: skipped,
      alertsEmitted: alertResult.alertsEmitted,
      alertsCapped: alertResult.alertsCapped,
    };
    await markSuccess(run.id, counts);
    recordForecastRun("success");
    recordProductsPredicted(predicted);
    for (const [reason, n] of Object.entries(skipped)) {
      recordProductsSkipped(reason, n);
    }

    // FR-FORECAST-009 audit row.
    try {
      await db.insert(auditLogsTable).values({
        actorType: "system",
        actorId: null,
        action: "forecast.run",
        targetType: "inventory_forecast_run",
        targetId: run.id,
        metadata: JSON.stringify({
          outcome: "success",
          productsPredicted: predicted,
          productsSkipped: skipped,
          alertsEmitted: alertResult.alertsEmitted,
          alertsCapped: alertResult.alertsCapped,
        }),
      });
    } catch (err) {
      logger.warn({ err, category: "forecast.run" }, "[forecast] audit log insert failed");
    }

    const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
    recordRunDuration(durationSeconds);

    logger.info(
      {
        category: "forecast.run",
        runId: run.id,
        productsPredicted: predicted,
        productsSkipped: skipped,
        alertsEmitted: alertResult.alertsEmitted,
        alertsCapped: alertResult.alertsCapped,
        durationSeconds: Number(durationSeconds.toFixed(3)),
      },
      `[forecast] run complete — ${predicted} predicted, ${alertResult.alertsEmitted} alerts`,
    );

    return {
      runId: run.id,
      outcome: "success",
      productsPredicted: predicted,
      productsSkipped: skipped,
      alertsEmitted: alertResult.alertsEmitted,
      alertsCapped: alertResult.alertsCapped,
      durationSeconds,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.error({ err, runId, category: "forecast.run" }, "[forecast] run failed");
    if (runId !== null) {
      await markFailure(runId, reason).catch(() => {});
    }
    recordForecastRun("failure");
    const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
    recordRunDuration(durationSeconds);
    return {
      runId,
      outcome: "failure",
      productsPredicted: predicted,
      productsSkipped: skipped,
      alertsEmitted: 0,
      alertsCapped: false,
      durationSeconds,
    };
  }
}
