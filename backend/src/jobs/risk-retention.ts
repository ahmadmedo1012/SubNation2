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
 */

import { db, riskEventsTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger";

export interface RetentionResult {
  unlabeledDeleted: number;
  labeledExpiredDeleted: number;
}

export async function reapExpiredRiskEvents(): Promise<RetentionResult> {
  // Unlabeled, older than 90 days.
  const unlabeled = await db.execute(sql`
    DELETE FROM risk_events e
    WHERE e.created_at < NOW() - INTERVAL '90 days'
      AND NOT EXISTS (SELECT 1 FROM risk_labels l WHERE l.risk_event_id = e.id)
  `);
  // Labeled, older than 97 days (90 + 7-day grace for retroactive review).
  const labeled = await db.execute(sql`
    DELETE FROM risk_events e
    WHERE e.created_at < NOW() - INTERVAL '97 days'
      AND EXISTS (SELECT 1 FROM risk_labels l WHERE l.risk_event_id = e.id)
  `);
  const unlabeledDeleted =
    (unlabeled as unknown as { rowCount?: number }).rowCount ??
    (unlabeled as unknown as Array<unknown>).length ??
    0;
  const labeledExpiredDeleted =
    (labeled as unknown as { rowCount?: number }).rowCount ??
    (labeled as unknown as Array<unknown>).length ??
    0;
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
