/**
 * Pure date helpers for the inventory demand-forecasting feature
 * (011-inventory-demand-forecast, T010).
 *
 * Kept side-effect-free so the statistical math (T013) can be exercised
 * in unit tests without hitting Postgres or `Date.now()`. Every consumer
 * passes the "today" reference in explicitly.
 */

/** ISO calendar date (YYYY-MM-DD) — what postgres `date` columns serialize as. */
export type IsoDate = string;

export function todayUtcDate(now: Date = new Date()): IsoDate {
  return toIsoDate(now);
}

export function toIsoDate(d: Date): IsoDate {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** Add `n` whole days to an IsoDate. Negative n moves backwards. */
export function addDays(date: IsoDate, n: number): IsoDate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return toIsoDate(d);
}

/** Inclusive clamp: return `date` clamped into `[lo, hi]`. */
export function clampDate(date: IsoDate, lo: IsoDate, hi: IsoDate): IsoDate {
  if (date < lo) return lo;
  if (date > hi) return hi;
  return date;
}

/** Calendar-day delta as integer (b - a). */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  const da = new Date(`${a}T00:00:00Z`).getTime();
  const db = new Date(`${b}T00:00:00Z`).getTime();
  return Math.round((db - da) / 86_400_000);
}

/** Day-of-week 0 (Sunday) … 6 (Saturday) for an IsoDate. */
export function dayOfWeek(date: IsoDate): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}
