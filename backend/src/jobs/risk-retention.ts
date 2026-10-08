/**
 * Risk-events retention (003-anomaly-detection, T054).
 *
 * Daily cleanup that bounds the working set of `risk_events`:
 *   - Unlabeled events older than 90 days are deleted.
 *   - Labeled events get a 97-day grace (so the label always
 *     joins back to a real row when an admin opens an old
 *     report).
 *   - `risk_labels` rows that still join to a live event are kept
 *     indefinitely — they're the training corpus for the Phase-3
 *     model.
 *
 * The data-model has `risk_labels.risk_event_id` declared
 * `ON DELETE SET NULL`, so a deleted event leaves the label row in
 * place with a null pointer. R123-E5 (R123-A7 P3): those orphans are
 * now pruned mechanically — a NULL-pointer label can never join back
 * to event features, so it holds no training value and no read path
 * resolves it; it is pure dead weight accumulating one row per
 * labeled event per 97 days. Orphans older than 30 days (grace for
 * any in-flight review window) are deleted; the grace also guarantees
 * a label orphaned TODAY is never deleted before the next review
 * cycle sees it. copilot_actions retention is deliberately NOT here —
 * that policy is an operator decision (see
 * docs/operations/OPERATOR_ACTIONS_R118.md).
 *
 * Batching (B7-P2-5, round-92): every DELETE runs in bounded ctid
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

// R123-E5 (R123-A7 P3): orphaned risk_labels grace window. A label with a
// NULL risk_event_id can never re-join (the event row is gone — deleted
// by this very ladder's 97-day pass via ON DELETE SET NULL), so 30 days
// only exists so a freshly-orphaned label survives the current review
// cycle before the prune takes it.
const ORPHAN_LABEL_GRACE_DAYS = 30;

export interface RetentionResult {
  unlabeledDeleted: number;
  labeledExpiredDeleted: number;
  orphanLabelsDeleted: number;
}

/**
 * Batched DELETE loop. The predicate is embedded verbatim in the subquery
 * so each batch re-evaluates it against the CURRENT table state (idempotent,
 * safe to interleave with concurrent inserts).
 */
async function batchedDelete(table: string, whereSql: string): Promise<number> {
  let deleted = 0;
  for (;;) {
    const result = await db.execute(
      sql.raw(`
      DELETE FROM ${table}
      WHERE ctid IN (
        SELECT ctid FROM ${table} e
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
    "risk_events",
    `e.created_at < NOW() - INTERVAL '90 days'
      AND NOT EXISTS (SELECT 1 FROM risk_labels l WHERE l.risk_event_id = e.id)`,
  );
  // Labeled, older than 97 days (90 + 7-day grace for retroactive review).
  const labeledExpiredDeleted = await batchedDelete(
    "risk_events",
    `e.created_at < NOW() - INTERVAL '97 days'
      AND EXISTS (SELECT 1 FROM risk_labels l WHERE l.risk_event_id = e.id)`,
  );
  // R123-E5 (R123-A7 P3): labels orphaned by the pass above (ON DELETE
  // SET NULL) — and any older-era orphan — pruned after the 30-day grace.
  // A JOINED label is never touched, whatever its age.
  const orphanLabelsDeleted = await batchedDelete(
    "risk_labels",
    `e.risk_event_id IS NULL
      AND e.labeled_at < NOW() - INTERVAL '${orphanLabelGraceDays()} days'`,
  );
  if (unlabeledDeleted + labeledExpiredDeleted + orphanLabelsDeleted > 0) {
    logger.info(
      {
        category: "risk.retention",
        unlabeled: unlabeledDeleted,
        labeled: labeledExpiredDeleted,
        orphanLabels: orphanLabelsDeleted,
      },
      "[risk-retention] purge complete",
    );
  }
  return { unlabeledDeleted, labeledExpiredDeleted, orphanLabelsDeleted };
}

/** Test seam: the grace window in days (pinned by risk-retention.test.ts). */
export function orphanLabelGraceDays(): number {
  return ORPHAN_LABEL_GRACE_DAYS;
}

// Reference riskEventsTable so the import isn't dropped in case the
// implementation pivots to Drizzle's typed delete builder later.
void riskEventsTable;
