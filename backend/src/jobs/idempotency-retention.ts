import { db, idempotencyKeysTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger";

/**
 * Retention window for `idempotency_keys` rows (R97-A3 retention audit).
 *
 * The HTTP-layer dedup cache (middlewares/idempotency.ts, Redis) already
 * expires keys after 24h — the durable table row only exists so a client
 * retry WITHIN that horizon replays the original order instead of
 * re-charging. 48h doubles the cache window as a safety margin for clock
 * skew and cache flushes, and stays far below any realistic
 * client-replay-interest horizon; anything older can never be a legitimate
 * retry (the money trail itself lives forever in orders + wallet_ledger —
 * deleting the key row deletes NO financial record).
 */
const RETENTION_HOURS = 48;
const DELETE_BATCH_SIZE = 1000;

/**
 * Delete idempotency_keys rows older than RETENTION_HOURS (97-F7).
 *
 * Scheduling: daily cron at 00:00 UTC (`jobs/cron.ts`, the round-5
 * retention policy slot) — see the cron entry for the slot rationale.
 *
 * R97-A3 finding: the table had NO retention of any kind. Rows are only
 * removed by the order/user CASCADE deletes, so every guarded purchase
 * grows the table by one row forever (unbounded table growth on the
 * money path's hottest insert path — pkey maintenance cost rises with
 * table size).
 *
 * Batching (B7-P2-5, same shape as cleanupOldAuthActivity): the DELETE
 * runs in bounded ctid batches of 1000 so a catch-up purge on Neon's
 * pooler holds a connection/lock for seconds, not minutes. Idempotent —
 * safe to run repeatedly. This module is library code only (cron/wiring
 * owns scheduling); it must NEVER self-exit — see the scheduling note in
 * cleanup-auth-activity.ts for the bundle-mode process.exit incident.
 */
export async function pruneOldIdempotencyKeys(): Promise<number> {
  // Cutoff computed in JS (same shape as cleanupOldAuthActivity) — keeps
  // the predicate a plain timestamptz comparison with a bound parameter.
  const cutoffDate = new Date();
  cutoffDate.setHours(cutoffDate.getHours() - RETENTION_HOURS);

  let deleted = 0;
  // Bounded batch loop: `ctid IN (SELECT … LIMIT n)` until the batch comes
  // back short. Keeps each statement's lock footprint tiny.
  for (;;) {
    const result = await db.execute(sql`
      DELETE FROM idempotency_keys
      WHERE ctid IN (
        SELECT ctid FROM idempotency_keys
        WHERE created_at < ${cutoffDate}
        LIMIT ${DELETE_BATCH_SIZE}
      )
      RETURNING key
    `);
    const rows =
      (result as unknown as { rows?: Array<{ key: string }> }).rows ??
      (result as unknown as Array<{ key: string }>) ??
      [];
    deleted += rows.length;
    if (rows.length < DELETE_BATCH_SIZE) break;
  }

  if (deleted > 0) {
    logger.info(
      { category: "idempotency.retention", deleted, retentionHours: RETENTION_HOURS },
      `[idempotency-retention] pruned ${deleted} key row(s) older than ${RETENTION_HOURS}h`,
    );
  }
  // Keep the drizzle table import meaningful for future typed migrations
  // of this job (same pattern as cleanup-auth-activity.ts).
  void idempotencyKeysTable;
  return deleted;
}
