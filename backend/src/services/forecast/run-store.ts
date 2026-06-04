/**
 * Forecast-runs CRUD (011-inventory-demand-forecast, T016).
 *
 * Wraps the small set of writes the orchestrator and the retention
 * cron need against `inventory_forecast_runs`. The runner is the only
 * caller; concurrency on this table is not a concern (the cron is
 * single-instance per worker tier).
 */

import { db, inventoryForecastRunsTable } from "@workspace/db";
import { and, desc, eq, isNotNull } from "drizzle-orm";

export type RunOutcome = "in_flight" | "success" | "failure";

export interface NewRunInput {
  workerTier?: string | null;
}

export async function createInFlightRun(input: NewRunInput = {}): Promise<{ id: number }> {
  const [row] = await db
    .insert(inventoryForecastRunsTable)
    .values({
      workerTier: input.workerTier ?? null,
    })
    .returning({ id: inventoryForecastRunsTable.id });
  if (!row) throw new Error("createInFlightRun: insert returned no row");
  return { id: row.id };
}

export interface RunCounts {
  productsPredicted: number;
  productsSkipped: Record<string, number>;
  alertsEmitted?: number;
  alertsCapped?: boolean;
}

export async function markSuccess(id: number, counts: RunCounts): Promise<void> {
  await db
    .update(inventoryForecastRunsTable)
    .set({
      outcome: "success",
      completedAt: new Date(),
      productsPredicted: counts.productsPredicted,
      productsSkipped: counts.productsSkipped,
      alertsEmitted: counts.alertsEmitted ?? 0,
      alertsCapped: counts.alertsCapped ?? false,
    })
    .where(eq(inventoryForecastRunsTable.id, id));
}

export async function markFailure(id: number, reason: string): Promise<void> {
  await db
    .update(inventoryForecastRunsTable)
    .set({
      outcome: "failure",
      completedAt: new Date(),
      failureReason: reason.slice(0, 1000),
    })
    .where(eq(inventoryForecastRunsTable.id, id));
}

export async function setCaptureRate(id: number, rate: number | null): Promise<void> {
  await db
    .update(inventoryForecastRunsTable)
    .set({ captureRate14d: rate == null ? null : rate.toFixed(3) })
    .where(eq(inventoryForecastRunsTable.id, id));
}

export interface SuccessfulRunSummary {
  id: number;
  startedAt: Date;
  completedAt: Date;
  productsPredicted: number;
  alertsEmitted: number;
  captureRate14d: number | null;
}

export async function latestSuccessful(): Promise<SuccessfulRunSummary | null> {
  const [row] = await db
    .select({
      id: inventoryForecastRunsTable.id,
      startedAt: inventoryForecastRunsTable.startedAt,
      completedAt: inventoryForecastRunsTable.completedAt,
      productsPredicted: inventoryForecastRunsTable.productsPredicted,
      alertsEmitted: inventoryForecastRunsTable.alertsEmitted,
      captureRate14d: inventoryForecastRunsTable.captureRate14d,
    })
    .from(inventoryForecastRunsTable)
    .where(
      and(
        eq(inventoryForecastRunsTable.outcome, "success"),
        isNotNull(inventoryForecastRunsTable.completedAt),
      ),
    )
    .orderBy(desc(inventoryForecastRunsTable.completedAt))
    .limit(1);
  if (!row || !row.completedAt) return null;
  return {
    id: row.id,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    productsPredicted: row.productsPredicted,
    alertsEmitted: row.alertsEmitted,
    captureRate14d: row.captureRate14d == null ? null : Number(row.captureRate14d),
  };
}
