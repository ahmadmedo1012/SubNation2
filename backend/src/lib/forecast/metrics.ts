/**
 * Forecast-pipeline Prometheus metrics (011-inventory-demand-forecast, T012).
 *
 * Counter/histogram set per spec FR-FORECAST-008. Mirrors the existing
 * `risk-metrics.ts` shape so on-call's mental model is consistent.
 */

import { Counter, Histogram } from "prom-client";
import { getRegistry } from "../metrics";

export const forecastRunsTotal = new Counter({
  name: "forecast_runs_total",
  help: "Total inventory-forecast runs (success/failure)",
  labelNames: ["outcome"] as const,
  registers: [getRegistry()],
});

export const forecastProductsPredictedTotal = new Counter({
  name: "forecast_products_predicted_total",
  help: "Total products that received a non-insufficient-data forecast",
  registers: [getRegistry()],
});

export const forecastProductsSkippedTotal = new Counter({
  name: "forecast_products_skipped_total",
  help: "Total products skipped by the forecast run, per reason",
  labelNames: ["reason"] as const,
  registers: [getRegistry()],
});

export const forecastAlertsEmittedTotal = new Counter({
  name: "forecast_alerts_emitted_total",
  help: "Total stockout alerts emitted by the forecast pipeline",
  registers: [getRegistry()],
});

export const forecastRunSeconds = new Histogram({
  name: "forecast_run_seconds",
  help: "Wall-clock duration of a single forecast run",
  buckets: [0.5, 1, 2, 5, 10, 30, 60, 120, 300],
  registers: [getRegistry()],
});

export function recordForecastRun(outcome: "success" | "failure"): void {
  try {
    forecastRunsTotal.inc({ outcome });
  } catch {
    // intentionally swallowed — metric emission must not break the runner
  }
}

export function recordProductsPredicted(n: number): void {
  if (n <= 0) return;
  try {
    forecastProductsPredictedTotal.inc(n);
  } catch {
    // see recordForecastRun
  }
}

export function recordProductsSkipped(reason: string, n: number): void {
  if (n <= 0) return;
  try {
    forecastProductsSkippedTotal.inc({ reason }, n);
  } catch {
    // see recordForecastRun
  }
}

export function recordAlertsEmitted(n: number): void {
  if (n <= 0) return;
  try {
    forecastAlertsEmittedTotal.inc(n);
  } catch {
    // see recordForecastRun
  }
}

export function recordRunDuration(seconds: number): void {
  try {
    forecastRunSeconds.observe(seconds);
  } catch {
    // see recordForecastRun
  }
}
