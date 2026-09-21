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
  return Number.isInteger(parsed) && parsed > 0 && String(parsed) === trimmed
    ? parsed
    : null;
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
