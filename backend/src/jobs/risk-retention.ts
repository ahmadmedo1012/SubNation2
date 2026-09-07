/**
 * Risk-events retention (003-anomaly-detection, T054).
 *
 * Daily cleanup that bounds the working set of `risk_events`:
 *   - Unlabeled events older than 90 days are deleted.
 *   - Labeled events get a 97-day grace (so the label always
 *     joins back to a real row when an admin opens an old
 *     report).
 *   - `risk_labels` rows themselves are kept indefinitely —
 *     they're the training corpus for the Phase-3 model.
 *
 * The data-model already has `risk_labels.risk_event_id`
 * declared `ON DELETE SET NULL`, so a deleted event leaves the
 * label row in place with a null pointer; nothing in the read
 * path treats that as an error.
 *
 * Batching (B7-P2-5, round-92): both DELETEs run in bounded ctid
 * batches of 1000 — a 90-day first purge (or restart catch-up) on
 * Neon's pooler must not hold a single unbounded statement lock for
 * minutes. Also runs as a boot one-shot in web-scheduler.ts (B7-P2-12)
 * so an instance that was down at the 03:30 slot still enforces the
 * policy that day.
 */

import { db, riskEventsTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger";

const DELETE_BATCH_SIZE = 1000;

export interface RetentionResult {
  unlabeledDeleted: number;
  labeledExpiredDeleted: number;
}

/**
 * Batched DELETE loop. The predicate is embedded verbatim in the subquery
 * so each batch re-evaluates it against the CURRENT table state (idempotent,
 * safe to interleave with concurrent inserts).
 */
async function batchedDelete(whereSql: string): Promise<number> {
  let deleted = 0;
  for (;;) {
    const result = await db.execute(
      sql.raw(`
      DELETE FROM risk_events
      WHERE ctid IN (
        SELECT ctid FROM risk_events e
        WHERE ${whereSql}
        LIMIT ${DELETE_BATCH_SIZE}
      )
      RETURNING id
    `),
    );
    const rows =
      (result as unknown as { rows?: Array<{ id: number }> }).rows ??
      (result as unknown as Array<{ id: number }>) ??
      [];
    deleted += rows.length;
    if (rows.length < DELETE_BATCH_SIZE) break;
  }
  return deleted;
}

export async function reapExpiredRiskEvents(): Promise<RetentionResult> {
  // Unlabeled, older than 90 days.
  const unlabeledDeleted = await batchedDelete(
    `e.created_at < NOW() - INTERVAL '90 days'
      AND NOT EXISTS (SELECT 1 FROM risk_labels l WHERE l.risk_event_id = e.id)`,
  );
  // Labeled, older than 97 days (90 + 7-day grace for retroactive review).
  const labeledExpiredDeleted = await batchedDelete(
    `e.created_at < NOW() - INTERVAL '97 days'
      AND EXISTS (SELECT 1 FROM risk_labels l WHERE l.risk_event_id = e.id)`,
  );
  if (unlabeledDeleted + labeledExpiredDeleted > 0) {
    logger.info(
      {
        category: "risk.retention",
        unlabeled: unlabeledDeleted,
        labeled: labeledExpiredDeleted,
      },
      "[risk-retention] purge complete",
    );
  }
  return { unlabeledDeleted, labeledExpiredDeleted };
}

// Reference riskEventsTable so the import isn't dropped in case the
// implementation pivots to Drizzle's typed delete builder later.
void riskEventsTable;
