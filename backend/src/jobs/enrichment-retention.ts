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

import {
  db,
  enrichmentDraftsTable,
  enrichmentRunsTable,
} from "@workspace/db";
import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { logger } from "../lib/logger";

export interface RetentionResult {
  draftsDeleted: number;
  runsReaped: number;
}

export async function runEnrichmentRetention(): Promise<RetentionResult> {
  const purgeResult = await db
    .delete(enrichmentDraftsTable)
    .where(
      and(
        sql`${enrichmentDraftsTable.createdAt} < NOW() - INTERVAL '90 days'`,
        inArray(enrichmentDraftsTable.state, ["published", "rejected", "draft_invalid"]),
      ),
    );
  const draftsDeleted =
    (purgeResult as unknown as { rowCount?: number }).rowCount ??
    (purgeResult as unknown as Array<unknown>).length ??
    0;

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
