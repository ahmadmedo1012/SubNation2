// R144-B2: moved verbatim from src/migrate.ts (original lines 157–190).
// R144-B2: Only the import block + minimal `export` keywords are new;
// R144-B2: the ONE dynamic-import specifier that moved (`./jobs/alertLogger`
// R144-B2: → `../jobs/alertLogger`, in alertMoneyConstraintIssue) is disclosed
// R144-B2: and machine-verified moved-not-modified (scripts/r144b2_verify_split.py).
import { db } from "@workspace/db";
import { type SQL } from "drizzle-orm";

/** Minimal executor signature so boot-critical SQL helpers stay unit-testable. */
export type SqlExecutor = (query: SQL) => Promise<unknown>;

export const defaultExecutor: SqlExecutor = (query) => db.execute(query);

/** Node-postgres and pglite drizzle drivers both return `.rows`; accept either. */
export function extractRows(result: unknown): Array<Record<string, unknown>> {
  const withRows = result as { rows?: Array<Record<string, unknown>> } | null | undefined;
  if (withRows && Array.isArray(withRows.rows)) return withRows.rows;
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  return [];
}

export function extractCount(result: unknown): number {
  const row = extractRows(result)[0] as { c?: number | string } | undefined;
  return Number(row?.c ?? 0);
}

/**
 * R135 (DB-1 — the R122-deferred cast debt, scoped to migrate.ts): the
 * typed twin of extractRows. The last ~6 `as any` casts on db.execute()
 * results each re-encoded the SAME dual-driver defense —
 * `result.rows?.[0] ?? result[0]` serves node-postgres (QueryResult.rows)
 * AND a bare-array driver shape (the pglite test harness) — but threw away
 * the row type to do it. This wrapper keeps the exact unwrapping
 * semantics (delegates to extractRows verbatim: .rows array → rows, bare
 * array → itself, anything else → []) while returning the rows AS the
 * caller's declared row shape. Zero behavior change by construction;
 * every adoption site below swaps only the cast, never the access path.
 */
export function rowsFromResult<T = Record<string, unknown>>(result: unknown): T[] {
  return extractRows(result) as T[];
}
