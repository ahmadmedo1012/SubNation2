/**
 * Enrichment retention (012-arabic-catalog-enrichment, T027).
 *
 * Daily cron at 04:00 UTC. Two responsibilities:
 *   1. Purge enrichment_drafts rows older than 90 days where state IN
 *      (published, rejected, draft_invalid). drafted rows stay forever
 *      (the admin's open queue).
 *   2. Reap orphaned in_flight runs older than 24h (mark failure with
 *      reason='abandoned').
 */

import { db, enrichmentDraftsTable, enrichmentRunsTable } from "@workspace/db";
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { logger } from "../lib/logger";

export interface RetentionResult {
  draftsDeleted: number;
  runsReaped: number;
}

const DELETE_BATCH_SIZE = 1000;

/**
 * Bounded ctid-batch DELETE loop — F11 (round-94 A6), same shape as
 * risk-retention.ts (B7-P2-5): the first large purge (enrichment pipeline
 * enabled after a dormant period) must not hold one unbounded statement
 * lock on Neon's pooler. Predicate embedded verbatim per batch (idempotent,
 * safe to interleave with concurrent inserts).
 */
async function batchedDelete(whereSql: string): Promise<number> {
  let deleted = 0;
  for (;;) {
    const result = await db.execute(
      sql.raw(`
      DELETE FROM enrichment_drafts
      WHERE ctid IN (
        SELECT ctid FROM enrichment_drafts d
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

export async function runEnrichmentRetention(): Promise<RetentionResult> {
  const draftsDeleted = await batchedDelete(
    `d.created_at < NOW() - INTERVAL '90 days'
      AND d.state IN ('published', 'rejected', 'draft_invalid')`,
  );

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const reapResult = await db
    .update(enrichmentRunsTable)
    .set({
      outcome: "failure",
      completedAt: new Date(),
      failureReason: "abandoned: in_flight > 24h",
    })
    .where(
      and(
        eq(enrichmentRunsTable.outcome, "in_flight"),
        lt(enrichmentRunsTable.startedAt, cutoff),
        isNull(enrichmentRunsTable.completedAt),
      ),
    );
  const runsReaped =
    (reapResult as unknown as { rowCount?: number }).rowCount ??
    (reapResult as unknown as Array<unknown>).length ??
    0;

  if (draftsDeleted + runsReaped > 0) {
    logger.info(
      { category: "enrichment.retention", draftsDeleted, runsReaped },
      "[enrichment-retention] purge + reap complete",
    );
  }

  return { draftsDeleted, runsReaped };
}

// F11: the purge moved to the raw batched DELETE above — reference the
// table so the import stays valid if the typed builder returns (same
// convention as risk-retention.ts).
void enrichmentDraftsTable;
