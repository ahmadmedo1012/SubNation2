import type { Request } from "express";

export function stringParam(req: Request, name: string): string {
  const value = req.params[name];

  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export function intParam(req: Request, name: string): number | null {
  const value = stringParam(req, name);
  const parsed = Number.parseInt(value, 10);

  return Number.isNaN(parsed) ? null : parsed;
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
