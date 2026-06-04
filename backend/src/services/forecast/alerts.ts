/**
 * Forecast alerts (011-inventory-demand-forecast, T018).
 *
 * For each at-risk forecast in the just-completed run that meets the
 * eligibility predicate (predicted_runout_at <= forecast_date + 3 days
 * AND confidence ∈ {high,medium}), write a row in `admin_alerts` and
 * dispatch via the existing alerting service. Honors:
 *   - 7-day per-product Redis dedupe (research §R-3)
 *   - 50-row per-run cap (FR-ALERT-005)
 *   - the `forecast:alerts:paused` Redis flag (SC-008 kill criterion)
 *   - existing `ALERTING_ENABLED=false` semantics (FR-ALERT-004)
 */

import { adminAlertsTable, db } from "@workspace/db";
import { logger } from "../../lib/logger";
import { isAlertingPaused, tryClaimAlertDedupe } from "../../lib/forecast/redis-flags";
import { recordAlertsEmitted } from "../../lib/forecast/metrics";
import { alertingService, type AlertEvent } from "../alerting.service";
import { selectRunAlertCandidates } from "./forecast-store";

const PER_RUN_ALERT_CAP = 50;

const APP_ORIGIN = (process.env.APP_ORIGIN ?? "").replace(/\/+$/, "");

function buildPanelUrl(productId: number): string {
  const base = APP_ORIGIN || "";
  return `${base}/admin/products?highlight=${productId}`;
}

export interface DispatchResult {
  alertsEmitted: number;
  alertsCapped: boolean;
  paused: boolean;
}

export async function dispatchForecastAlerts(runId: number): Promise<DispatchResult> {
  if (await isAlertingPaused()) {
    return { alertsEmitted: 0, alertsCapped: false, paused: true };
  }

  const candidates = await selectRunAlertCandidates(runId);
  let emitted = 0;
  let capped = false;

  for (const c of candidates) {
    if (emitted >= PER_RUN_ALERT_CAP) {
      capped = true;
      logger.warn(
        { category: "forecast.alerts", runId, dropped: candidates.length - emitted },
        "[forecast-alerts] per-run cap hit; remaining alerts dropped",
      );
      break;
    }
    const claimed = await tryClaimAlertDedupe(c.productId);
    if (!claimed) continue; // already alerted within the 7-day window

    // 1. Persist the durable admin_alerts row (always; the DB is the
    //    durable channel, Telegram/Discord are best-effort).
    try {
      await db.insert(adminAlertsTable).values({
        type: "forecast_stockout",
        title: `${c.productName}: نفاد متوقع خلال ${daysUntilLabel(c.predictedRunoutAt)}`,
        message: JSON.stringify({
          kind: "forecast_stockout",
          product_id: c.productId,
          product_name: c.productName,
          predicted_runout_at: c.predictedRunoutAt,
          current_stock_on_hand: c.currentStockOnHand,
          confidence: c.confidence,
          forecast_id: c.forecastId,
          investigation_url: buildPanelUrl(c.productId),
        }),
      });
    } catch (err) {
      logger.warn(
        { err, runId, productId: c.productId, category: "forecast.alerts" },
        "[forecast-alerts] admin_alerts insert failed",
      );
    }

    // 2. Best-effort outbound dispatch via the existing alerting service.
    //    Honors ALERTING_ENABLED inside the service itself; we don't gate it
    //    here so that the durable row is written either way (FR-ALERT-004).
    try {
      const event: AlertEvent = {
        rule: "forecast_stockout",
        severity: c.confidence === "high" ? "critical" : "warning",
        value: c.currentStockOnHand,
        threshold: 3,
        firedAt: new Date().toISOString(),
        labels: {
          rule: "forecast_stockout",
          severity: c.confidence === "high" ? "critical" : "warning",
          product_id: String(c.productId),
        },
        dedupKey: `forecast_stockout|${c.productId}`,
        summary: [
          `${c.productName} (#${c.productId}) متوقع نفاده في ${c.predictedRunoutAt}`,
          `المخزون الحالي: ${c.currentStockOnHand}`,
          `الثقة: ${c.confidence}`,
          `لوحة المراجعة: ${buildPanelUrl(c.productId)}`,
        ].join("\n"),
        runbookUrl: APP_ORIGIN
          ? `${APP_ORIGIN}/docs/OPERATIONS_RUNBOOK.md#forecast`
          : "",
      };
      await alertingService.dispatchAlert(event);
    } catch (err) {
      logger.warn(
        { err, runId, productId: c.productId, category: "forecast.alerts" },
        "[forecast-alerts] dispatch threw — swallowed",
      );
    }

    emitted++;
  }

  recordAlertsEmitted(emitted);
  return { alertsEmitted: emitted, alertsCapped: capped, paused: false };
}

function daysUntilLabel(predictedRunoutAt: string): string {
  const ms = new Date(`${predictedRunoutAt}T00:00:00Z`).getTime() - Date.now();
  const days = Math.max(0, Math.ceil(ms / 86_400_000));
  if (days === 0) return "اليوم";
  if (days === 1) return "يوم واحد";
  if (days === 2) return "يومين";
  return `${days} أيام`;
}
