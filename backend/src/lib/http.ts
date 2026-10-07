import type { Request } from "express";

export function stringParam(req: Request, name: string): string {
  const value = req.params[name];

  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export function intParam(req: Request, name: string): number | null {
  const value = stringParam(req, name);
  const trimmed = value.trim();
  const parsed = Number.parseInt(trimmed, 10);

  // A5-14 (round-94): the OpenAPI contract documents 400 «Invalid
  // (non-integer) id» for the :id params, but parseInt() happily accepted
  // "-5" (negative PK → wasted DB round trip → 404 with the wrong shape)
  // and "12abc" (silent truncation). Digit-exact strict parse: only a
  // positive integer whose canonical string form equals the input passes.
  return Number.isInteger(parsed) && parsed > 0 && String(parsed) === trimmed ? parsed : null;
}

export function queryString(req: Request, name: string, fallback = ""): string {
  const value = req.query[name];

  if (Array.isArray(value)) {
    const first = value[0];
    return typeof first === "string" ? first : fallback;
  }

  return typeof value === "string" ? value : fallback;
}

/**
 * R120-B6/A6-F1: clamp helper for user-facing list `?limit=` params.
 *
 * Canonicalizes the exact clamp idiom the user orders list has used since
 * round-3 (8-c §2.4): parseInt of the (first) query value, NaN → `def`,
 * clamped to [1, max]. Byte-identical to the previous inline code for
 * every current input — including the array/multi-value and non-string
 * query shapes, which `queryString` collapses the same way `String()`
 * did (A6-F14: no drift on adoption).
 *
 * NOTE: routes that historically used the stricter `Number()` +
 * `Number.isInteger` idiom (wallet/loyalty ledgers reject "12.9"/"1e2"
 * where this helper would parse 12/1) intentionally do NOT adopt this —
 * adoption must keep behavior identical for every current input.
 */
export function limitParam(req: Request, def: number, max: number): number {
  const raw = parseInt(queryString(req, "limit", String(def)), 10);
  return Number.isNaN(raw) ? def : Math.min(Math.max(raw, 1), max);
}

/**
 * R120-B6/A6-F1: clamp helper for user-facing list `?page=` params — the
 * exact admin/orders.ts:213-217 idiom (page ≥ 1; NaN/garbage/0 → 1).
 */
export function pageParam(req: Request): number {
  return Math.max(Number.parseInt(queryString(req, "page", "1"), 10) || 1, 1);
}

/**
 * AUD103-3-F4 (r103): escape SQL LIKE wildcards in an admin search term.
 * `%` / `_` inside the search input would otherwise act as pattern
 * wildcards (a bare "%" search matched every row, enabling pattern scans
 * beyond the intended substring search). Backslash is escaped first so
 * the inserted escapes can't be neutralized. The value is STILL bound as
 * a parameter everywhere — this is pattern hygiene, not injection
 * defense (drizzle parameterization already covers that).
 */
export function escapeLikeTerm(term: string): string {
  return term.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export function rowsFromResult<T>(result: T[] | { rows?: T[] }): T[] {
  if (Array.isArray(result)) return result;
  return result.rows ?? [];
}
