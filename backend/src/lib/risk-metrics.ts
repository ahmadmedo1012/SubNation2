/**
 * Risk-pipeline Prometheus metrics (T014).
 *
 * Counters/histograms per spec §7.4 and the contract in
 * `specs/003-anomaly-detection/research.md`. Mirrors the
 * existing `backend/src/lib/metrics.ts` pattern: each metric
 * is a `prom-client` instance registered with the singleton
 * registry; observation helpers wrap try/catch so a metrics
 * failure never breaks the scoring path.
 */

import { Counter, Histogram } from "prom-client";

import { getRegistry, monitoringErrorsTotal, safeInc, safeObserve } from "./metrics";

// ---------- Counters ------------------------------------------------------

export const riskEventsScoredTotal = new Counter({
  name: "risk_events_scored_total",
  help: "Total number of events scored by the risk pipeline",
  labelNames: ["event_type", "level"] as const,
  registers: [getRegistry()],
});

export const riskRuleFiredTotal = new Counter({
  name: "risk_rule_fired_total",
  help: "Total number of times a risk rule fired",
  labelNames: ["rule_name"] as const,
  registers: [getRegistry()],
});

export const riskAlertsSentTotal = new Counter({
  name: "risk_alerts_sent_total",
  help: "Total number of risk alerts dispatched",
  labelNames: ["channel", "level"] as const,
  registers: [getRegistry()],
});

export const riskLabelsTotal = new Counter({
  name: "risk_labels_total",
  help: "Total number of human labels recorded for risk events",
  labelNames: ["label"] as const,
  registers: [getRegistry()],
});

export const riskAlertDeliveryFailedTotal = new Counter({
  name: "risk_alert_delivery_failed_total",
  help: "Critical-event alerts that failed to dispatch (per channel)",
  labelNames: ["channel"] as const,
  registers: [getRegistry()],
});

export const riskPipelineFallbacksTotal = new Counter({
  name: "risk_pipeline_fallbacks_total",
  help: "Risk pipeline degraded to rules-only after an internal error",
  labelNames: ["reason"] as const,
  registers: [getRegistry()],
});

// ---------- Histograms ----------------------------------------------------

export const riskScoringDurationSeconds = new Histogram({
  name: "risk_scoring_duration_seconds",
  help: "Time taken to compute a risk score for an event",
  labelNames: ["event_type"] as const,
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [getRegistry()],
});

export const riskAlertDeliverySeconds = new Histogram({
  name: "risk_alert_delivery_seconds",
  help: "Latency from critical-event detection to alert delivery (per channel)",
  labelNames: ["channel"] as const,
  buckets: [0.5, 1, 2, 5, 10, 20, 30, 45, 60, 90, 120],
  registers: [getRegistry()],
});

/**
 * SC-005 admin-to-action time: histogram seconds from
 * critical-alert send → first admin label/action on that event
 * (T055b). Bucket choice covers 1m..2h to match the SLO of
 * ≤15min median, ≤60min p95.
 */
export const riskAdminToActionSeconds = new Histogram({
  name: "risk_admin_to_action_seconds",
  help: "Time from critical-alert dispatch to first admin label/action",
  labelNames: ["level"] as const,
  buckets: [60, 180, 300, 600, 900, 1800, 3600, 7200],
  registers: [getRegistry()],
});

// ---------- Helpers --------------------------------------------------------

export function recordEventScored(eventType: string, level: string): void {
  safeInc(riskEventsScoredTotal, { event_type: eventType, level });
}

export function recordRuleFired(ruleName: string): void {
  safeInc(riskRuleFiredTotal, { rule_name: ruleName });
}

export function recordAlertSent(channel: string, level: string): void {
  safeInc(riskAlertsSentTotal, { channel, level });
}

export function recordLabel(label: string): void {
  safeInc(riskLabelsTotal, { label });
}

export function recordPipelineFallback(reason: string): void {
  safeInc(riskPipelineFallbacksTotal, { reason });
}

export function recordScoringDuration(eventType: string, seconds: number): void {
  safeObserve(riskScoringDurationSeconds, { event_type: eventType }, seconds);
}

export function recordAlertDelivery(channel: string, seconds: number): void {
  safeObserve(riskAlertDeliverySeconds, { channel }, seconds);
}

export function recordAdminToAction(level: string, seconds: number): void {
  safeObserve(riskAdminToActionSeconds, { level }, seconds);
}

// Suppress unused-import warning for the helper we re-export
void monitoringErrorsTotal;
