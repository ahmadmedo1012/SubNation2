// R144-B2: moved verbatim from src/migrate.ts (original lines 191–238).
// R144-B2: Only the import block + minimal `export` keywords are new;
// R144-B2: the ONE dynamic-import specifier that moved (`./jobs/alertLogger`
// R144-B2: → `../jobs/alertLogger`, in alertMoneyConstraintIssue) is disclosed
// R144-B2: and machine-verified moved-not-modified (scripts/r144b2_verify_split.py).
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { type SqlExecutor, defaultExecutor, extractRows } from "./shared";

/**
 * Ensure the pg_trgm extension exists WITHOUT issuing DDL when it already
 * does (B7-P0-1, round-92 audit).
 *
 * `CREATE EXTENSION` is rejected by Postgres in a read-only window even
 * when the extension is already installed — the command-class check fires
 * before the no-op effect is evaluated, and that exact statement killed
 * deploy dep-daf0rt8n74is73fraih0. A pg_extension catalog read is permitted
 * on a read-only standby, so we probe first and only CREATE when genuinely
 * absent. Steady-state boots execute zero extension DDL.
 *
 * Returns true when the extension is usable; callers skip the trigram GIN
 * indexes otherwise (fuzzy search falls back to a seq scan — slower, never
 * broken). If the CREATE itself is rejected as read-only (SQLSTATE 25006),
 * the error is re-thrown so boot-migrations.ts classifies it transient and
 * retries the whole run once the failover window clears. Other failures
 * (extension unavailable in this environment — e.g. the pglite test
 * harness) are logged and downgraded to "not available".
 */
export async function ensurePgTrgmExtension(
  execute: SqlExecutor = defaultExecutor,
): Promise<boolean> {
  const probeRows = extractRows(
    await execute(sql`SELECT 1 AS present FROM pg_extension WHERE extname = 'pg_trgm'`),
  );
  if (probeRows.length > 0) return true;
  try {
    await execute(sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    return true;
  } catch (err) {
    const code = (err as { code?: string }).code;
    const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
    if (
      code === "25006" ||
      msg.includes("read-only transaction") ||
      msg.includes("read-only mode")
    ) {
      // Read-only window — surface it so the transient retry machinery engages.
      throw err;
    }
    logger.warn(
      { err, code },
      "pg_trgm not available in this environment — trigram indexes will be skipped (fuzzy search falls back to seq scan)",
    );
    return false;
  }
}
