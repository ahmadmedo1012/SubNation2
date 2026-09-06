/**
 * Round-3 (8-a §1B — money-parse single source): `parseFloat(String(col))`
 * appeared 40+ times across the backend — the most repeated money idiom
 * in the repo. Every copy independently decided what to do with NULL,
 * empty string, NaN and Infinity. Drizzle returns numeric columns as
 * strings; this helper centralizes the conversion policy:
 *
 *   - null/undefined/""/whitespace → fallback (default 0)
 *   - unparsable garbage            → fallback
 *   - non-finite (Infinity/NaN)     → fallback  — NEVER propagate:
 *     a single Infinity flowing into a wallet UPDATE corrupts the row
 *     for every subsequent transaction (the M1 class of bugs).
 *
 * Callers that need to distinguish "0 by policy" from "bad data" read
 * the raw column themselves.
 */
export function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : fallback;
  }
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (trimmed === "") return fallback;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : fallback;
}
