/**
 * Forecast alerts (011-inventory-demand-forecast, T018).
 *
 * For each at-risk forecast in the just-completed run that meets the
 * eligibility predicate (predicted_runout_at <= forecast_date + 3 days
 * AND confidence ∈ {high,medium}), write a row in `admin_alerts` and
 * dispatch via the existing alerting service. Honors:
 *   - 7-day per-product dedupe (research §R-3) — durable DB-level via
 *     logAdminAlert's dedupe_key (A6-P2-3, round-93) + the Redis claim
 *     as a fast-path for Redis-provisioned deployments
 *   - 50-row per-run cap (FR-ALERT-005)
 *   - the `forecast:alerts:paused` Redis flag (SC-008 kill criterion)
 *   - existing `ALERTING_ENABLED=false` semantics (FR-ALERT-004)
 *
 * A6-P2-3 (round-93): the insert used to be a raw `db.insert(adminAlerts)`
 * with NO dedupe_key and NO socket emit — the only suppression was the
 * Redis NX claim, which silently degrades to "emit anyway" on the
 * Redis-less production topology, so every daily run would have
 * re-alerted every at-risk product into the drawer forever (the round-5
 * spam class, resurrected through a side door) with no kill switch.
 * Routing through logAdminAlert adds restart- and Redis-independent
 * 7-day dedupe, the admin-alert-new socket fan-out, and AlertType-union
 * consistency in one call.
 */

import { logger } from "../../lib/logger";
import { logAdminAlert } from "../../jobs/alertLogger";
import { isAlertingPaused, tryClaimAlertDedupe } from "../../lib/forecast/redis-flags";
import { recordAlertsEmitted } from "../../lib/forecast/metrics";
import { alertingService, type AlertEvent } from "../alerting.service";
import { selectRunAlertCandidates } from "./forecast-store";

const PER_RUN_ALERT_CAP = 50;
const ALERT_DEDUPE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

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

    // 1. Persist the durable admin_alerts row via logAdminAlert (A6-P2-3,
    //    round-93): 7-day dedupe_key + admin-alert-new socket fan-out in
    //    one call. The DB is the durable channel — the dedupe below is
    //    what protects the drawer AND the outbound dispatch on the
    //    Redis-less live topology (the Redis claim alone degrades to
    //    no-dedupe there). Insert failures are swallowed inside
    //    logAdminAlert (returns not-suppressed), so the best-effort
    //    dispatch below still fires — FR-ALERT-004 semantics preserved.
    const outcome = await logAdminAlert(
      "forecast_stockout",
      `${c.productName}: نفاد متوقع خلال ${daysUntilLabel(c.predictedRunoutAt)}`,
      JSON.stringify({
        kind: "forecast_stockout",
        product_id: c.productId,
        product_name: c.productName,
        predicted_runout_at: c.predictedRunoutAt,
        current_stock_on_hand: c.currentStockOnHand,
        confidence: c.confidence,
        forecast_id: c.forecastId,
        investigation_url: buildPanelUrl(c.productId),
      }),
      { dedupeKey: `forecast:stockout:${c.productId}`, dedupeWindowMs: ALERT_DEDUPE_WINDOW_MS },
    );
    if (outcome.suppressed) {
      // A durable row with the same key exists inside the 7-day window —
      // skip every channel, not just the insert (the old code kept
      // dispatching the SRE event on DB-suppressed products).
      continue;
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
        runbookUrl: APP_ORIGIN ? `${APP_ORIGIN}/docs/OPERATIONS_RUNBOOK.md#forecast` : "",
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
