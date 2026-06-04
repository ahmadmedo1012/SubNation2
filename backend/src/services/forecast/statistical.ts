/**
 * Pure forecasting helpers (011-inventory-demand-forecast, T013).
 *
 * Stateless math: every function takes plain JS arrays / numbers and
 * returns plain JS values. No DB, no Redis, no network — the unit-test
 * surface for the day-of-week multiplier + moving-average baseline.
 *
 * Algorithm reference: research.md §R-1.
 */

import { addDays, dayOfWeek, type IsoDate } from "../../lib/forecast/dates";

export type Confidence = "high" | "medium" | "low" | "insufficient_data";

export interface OrderHistoryDay {
  /** Calendar date of the order (UTC). */
  date: IsoDate;
  /** Number of units sold that day for this product. */
  count: number;
}

const HISTORY_DAYS = 14;
const DOW_LOOKBACK_DAYS = 28;

/**
 * Mean daily sales over the last 14 days. Caller passes the full
 * history list; missing-day rows are NOT inferred — use `densify()`
 * first if you need that.
 */
export function computeAvgDailySales(history: OrderHistoryDay[]): number {
  if (history.length === 0) return 0;
  const total = history.reduce((sum, d) => sum + d.count, 0);
  return total / HISTORY_DAYS;
}

/**
 * Day-of-week multiplier: ratio of avg sales on `targetDow` over the
 * last 28 days vs the overall avg over the same 28 days.
 *
 * Returns 1.0 when the denominator is zero (no signal; treat the day
 * as neutral).
 */
export function computeDowMultiplier(
  history28d: OrderHistoryDay[],
  targetDow: number,
): number {
  if (history28d.length === 0) return 1;
  const dowEntries = history28d.filter((d) => dayOfWeek(d.date) === targetDow);
  if (dowEntries.length === 0) return 1;
  const dowAvg = dowEntries.reduce((s, d) => s + d.count, 0) / dowEntries.length;
  const overallAvg = history28d.reduce((s, d) => s + d.count, 0) / history28d.length;
  if (overallAvg <= 0) return 1;
  const m = dowAvg / overallAvg;
  // Clamp to a reasonable range so a single-day spike on the look-back
  // window doesn't blow up the prediction.
  if (!Number.isFinite(m)) return 1;
  return Math.max(0.1, Math.min(5, m));
}

/**
 * Average of the next 7 day-of-week multipliers, starting from
 * `forecastDate`. Used by `predictDemand7d`.
 */
export function computeDowBlend7d(
  history28d: OrderHistoryDay[],
  forecastDate: IsoDate,
): number {
  let sum = 0;
  for (let offset = 0; offset < 7; offset++) {
    const day = addDays(forecastDate, offset);
    sum += computeDowMultiplier(history28d, dayOfWeek(day));
  }
  return sum / 7;
}

export function predictDemand7d(avgDailySales: number, dowBlend7d: number): number {
  return Math.round(avgDailySales * dowBlend7d * 7);
}

/**
 * 30-day prediction. We average the multipliers across the 30-day
 * horizon since each weekday will appear ≈4× and we don't want a
 * single-day window distorting the result.
 */
export function predictDemand30d(
  history28d: OrderHistoryDay[],
  forecastDate: IsoDate,
  avgDailySales: number,
): number {
  let sum = 0;
  for (let offset = 0; offset < 30; offset++) {
    const day = addDays(forecastDate, offset);
    sum += computeDowMultiplier(history28d, dayOfWeek(day));
  }
  const blend30d = sum / 30;
  return Math.round(avgDailySales * blend30d * 30);
}

/**
 * Confidence tier (research §R-1):
 *   - insufficient_data: < 14 history days available.
 *   - low: 14 days but ≥ 7 zero-sales days.
 *   - medium: 14 days, < 7 zero-sales days, but coefficient-of-variation ≥ 0.5.
 *   - high: 14 days, < 7 zero-sales days, CV < 0.5.
 */
export function deriveConfidence(history: OrderHistoryDay[]): Confidence {
  if (history.length < HISTORY_DAYS) return "insufficient_data";
  const counts = history.map((d) => d.count);
  const zeros = counts.filter((c) => c === 0).length;
  if (zeros >= 7) return "low";
  const mean = counts.reduce((s, c) => s + c, 0) / counts.length;
  if (mean === 0) return "low";
  const variance =
    counts.reduce((s, c) => s + (c - mean) * (c - mean), 0) / counts.length;
  const stddev = Math.sqrt(variance);
  const cv = stddev / mean;
  return cv < 0.5 ? "high" : "medium";
}

/**
 * Densify a sparse order-count history into one entry per calendar day
 * over the requested window. Any day that has zero orders gets `count: 0`
 * — the moving-average and confidence calculations need the zero days
 * (otherwise a 7-day-zero week reads as "no data" instead of "low").
 */
export function densifyHistory(
  sparse: OrderHistoryDay[],
  forecastDate: IsoDate,
  days = HISTORY_DAYS,
): OrderHistoryDay[] {
  const map = new Map(sparse.map((d) => [d.date, d.count]));
  const out: OrderHistoryDay[] = [];
  for (let i = days; i >= 1; i--) {
    const date = addDays(forecastDate, -i);
    out.push({ date, count: map.get(date) ?? 0 });
  }
  return out;
}

export const HISTORY_WINDOW = HISTORY_DAYS;
export const DOW_WINDOW = DOW_LOOKBACK_DAYS;
