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

export function rowsFromResult<T>(result: T[] | { rows?: T[] }): T[] {
  if (Array.isArray(result)) return result;
  return result.rows ?? [];
}
