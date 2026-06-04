/**
 * Enrichment-runs CRUD (012-arabic-catalog-enrichment, T009).
 *
 * Wraps the small set of writes the orchestrator needs against
 * `enrichment_runs`. Mirrors the shape of the 011 forecast run-store.
 */

import { db, enrichmentRunsTable } from "@workspace/db";
import { desc, eq, isNotNull } from "drizzle-orm";

export async function createInFlightRun(input: {
  workerTier?: string | null;
  dailyTokenCap: number;
}): Promise<{ id: number }> {
  const [row] = await db
    .insert(enrichmentRunsTable)
    .values({
      workerTier: input.workerTier ?? null,
      dailyTokenCap: input.dailyTokenCap,
    })
    .returning({ id: enrichmentRunsTable.id });
  if (!row) throw new Error("createInFlightRun: insert returned no row");
  return { id: row.id };
}

export interface RunCounts {
  draftsGenerated: number;
  draftsInvalid: number;
  productsSkipped: Record<string, number>;
  tokensSpent: number;
  capReached: boolean;
}

export async function markSuccess(id: number, counts: RunCounts): Promise<void> {
  await db
    .update(enrichmentRunsTable)
    .set({
      outcome: "success",
      completedAt: new Date(),
      draftsGenerated: counts.draftsGenerated,
      draftsInvalid: counts.draftsInvalid,
      productsSkipped: counts.productsSkipped,
      tokensSpent: counts.tokensSpent,
      capReached: counts.capReached,
    })
    .where(eq(enrichmentRunsTable.id, id));
}

export async function markFailure(
  id: number,
  reason: string,
  partial: Partial<RunCounts> = {},
): Promise<void> {
  await db
    .update(enrichmentRunsTable)
    .set({
      outcome: "failure",
      completedAt: new Date(),
      failureReason: reason.slice(0, 1000),
      draftsGenerated: partial.draftsGenerated ?? 0,
      draftsInvalid: partial.draftsInvalid ?? 0,
      productsSkipped: partial.productsSkipped ?? {},
      tokensSpent: partial.tokensSpent ?? 0,
      capReached: partial.capReached ?? false,
    })
    .where(eq(enrichmentRunsTable.id, id));
}

export interface SuccessfulRunSummary {
  id: number;
  startedAt: Date;
  completedAt: Date;
  draftsGenerated: number;
  draftsInvalid: number;
  tokensSpent: number;
  capReached: boolean;
}

export async function latestSuccessful(): Promise<SuccessfulRunSummary | null> {
  const [row] = await db
    .select({
      id: enrichmentRunsTable.id,
      startedAt: enrichmentRunsTable.startedAt,
      completedAt: enrichmentRunsTable.completedAt,
      draftsGenerated: enrichmentRunsTable.draftsGenerated,
      draftsInvalid: enrichmentRunsTable.draftsInvalid,
      tokensSpent: enrichmentRunsTable.tokensSpent,
      capReached: enrichmentRunsTable.capReached,
    })
    .from(enrichmentRunsTable)
    .where(eq(enrichmentRunsTable.outcome, "success"))
    .orderBy(desc(enrichmentRunsTable.completedAt))
    .limit(1);
  if (!row || !row.completedAt) return null;
  return {
    id: row.id,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    draftsGenerated: row.draftsGenerated,
    draftsInvalid: row.draftsInvalid,
    tokensSpent: row.tokensSpent,
    capReached: row.capReached,
  };
}

void isNotNull;
