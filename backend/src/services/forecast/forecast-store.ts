/**
 * Forecast row CRUD (011-inventory-demand-forecast, T017).
 *
 * Reads + upserts on `inventory_forecasts`. The unique index on
 * (product_id, forecast_date) is what makes the daily run idempotent
 * (FR-FORECAST-006); upsert-on-conflict here is the only writer.
 */

import {
  db,
  inventoryForecastsTable,
  inventoryForecastRunsTable,
  productsTable,
} from "@workspace/db";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { Confidence } from "./statistical";

export interface ForecastUpsertInput {
  runId: number;
  productId: number;
  forecastDate: string; // YYYY-MM-DD
  currentStockOnHand: number;
  avgDailySales: number | null;
  dowBlend7d: number | null;
  predictedDemand7d: number | null;
  predictedDemand30d: number | null;
  predictedRunoutAt: string | null;
  recommendedReorderQty: number | null;
  confidence: Confidence;
  atRisk: boolean;
}

export async function upsertForecast(input: ForecastUpsertInput): Promise<void> {
  await db
    .insert(inventoryForecastsTable)
    .values({
      runId: input.runId,
      productId: input.productId,
      forecastDate: input.forecastDate,
      currentStockOnHand: input.currentStockOnHand,
      avgDailySales: input.avgDailySales == null ? null : input.avgDailySales.toFixed(4),
      dowBlend7d: input.dowBlend7d == null ? null : input.dowBlend7d.toFixed(4),
      predictedDemand7d: input.predictedDemand7d,
      predictedDemand30d: input.predictedDemand30d,
      predictedRunoutAt: input.predictedRunoutAt,
      recommendedReorderQty: input.recommendedReorderQty,
      confidence: input.confidence,
      atRisk: input.atRisk,
    })
    .onConflictDoUpdate({
      target: [inventoryForecastsTable.productId, inventoryForecastsTable.forecastDate],
      set: {
        runId: input.runId,
        currentStockOnHand: input.currentStockOnHand,
        avgDailySales: input.avgDailySales == null ? null : input.avgDailySales.toFixed(4),
        dowBlend7d: input.dowBlend7d == null ? null : input.dowBlend7d.toFixed(4),
        predictedDemand7d: input.predictedDemand7d,
        predictedDemand30d: input.predictedDemand30d,
        predictedRunoutAt: input.predictedRunoutAt,
        recommendedReorderQty: input.recommendedReorderQty,
        confidence: input.confidence,
        atRisk: input.atRisk,
        createdAt: new Date(),
      },
    });
}

export interface AtRiskRow {
  productId: number;
  productName: string;
  productImageUrl: string | null;
  productSlug: string | null;
  category: string | null;
  currentStockOnHand: number;
  avgDailySales: number | null;
  predictedDemand7d: number | null;
  predictedDemand30d: number | null;
  predictedRunoutAt: string | null;
  recommendedReorderQty: number | null;
  confidence: Confidence;
  forecastDate: string;
}

/**
 * Top-N at-risk forecasts ordered by predicted-runout ascending. Joins
 * `products` so the panel can render thumbnail + name + category in
 * one round-trip.
 */
export async function latestAtRisk(limit: number): Promise<AtRiskRow[]> {
  const rows = await db
    .select({
      productId: inventoryForecastsTable.productId,
      productName: productsTable.name,
      productImageUrl: productsTable.imageUrl,
      productSlug: productsTable.slug,
      category: productsTable.category,
      currentStockOnHand: inventoryForecastsTable.currentStockOnHand,
      avgDailySales: inventoryForecastsTable.avgDailySales,
      predictedDemand7d: inventoryForecastsTable.predictedDemand7d,
      predictedDemand30d: inventoryForecastsTable.predictedDemand30d,
      predictedRunoutAt: inventoryForecastsTable.predictedRunoutAt,
      recommendedReorderQty: inventoryForecastsTable.recommendedReorderQty,
      confidence: inventoryForecastsTable.confidence,
      forecastDate: inventoryForecastsTable.forecastDate,
    })
    .from(inventoryForecastsTable)
    .innerJoin(productsTable, eq(productsTable.id, inventoryForecastsTable.productId))
    .where(
      and(
        eq(inventoryForecastsTable.atRisk, true),
        isNotNull(inventoryForecastsTable.predictedRunoutAt),
        eq(productsTable.isArchived, false),
        eq(productsTable.isActive, true),
        // Always read the most recent forecast per product. The index on
        // (product_id, forecast_date DESC) makes this constant-time.
        sql`${inventoryForecastsTable.forecastDate} = (
          SELECT MAX(f2.forecast_date) FROM inventory_forecasts f2
          WHERE f2.product_id = ${inventoryForecastsTable.productId}
        )`,
      ),
    )
    .orderBy(inventoryForecastsTable.predictedRunoutAt)
    .limit(limit);

  return rows.map((r) => ({
    productId: r.productId,
    productName: r.productName,
    productImageUrl: r.productImageUrl,
    productSlug: r.productSlug,
    category: r.category,
    currentStockOnHand: r.currentStockOnHand,
    avgDailySales: r.avgDailySales == null ? null : Number(r.avgDailySales),
    predictedDemand7d: r.predictedDemand7d,
    predictedDemand30d: r.predictedDemand30d,
    predictedRunoutAt: r.predictedRunoutAt,
    recommendedReorderQty: r.recommendedReorderQty,
    confidence: r.confidence as Confidence,
    forecastDate: r.forecastDate,
  }));
}

/** Latest forecast row for a single product, or null when nothing exists. */
export async function latestForProduct(
  productId: number,
): Promise<(AtRiskRow & { dowBlend7d: number | null; daysOfHistoryAvailable: number }) | null> {
  const [row] = await db
    .select({
      productId: inventoryForecastsTable.productId,
      productName: productsTable.name,
      productImageUrl: productsTable.imageUrl,
      productSlug: productsTable.slug,
      category: productsTable.category,
      currentStockOnHand: inventoryForecastsTable.currentStockOnHand,
      avgDailySales: inventoryForecastsTable.avgDailySales,
      dowBlend7d: inventoryForecastsTable.dowBlend7d,
      predictedDemand7d: inventoryForecastsTable.predictedDemand7d,
      predictedDemand30d: inventoryForecastsTable.predictedDemand30d,
      predictedRunoutAt: inventoryForecastsTable.predictedRunoutAt,
      recommendedReorderQty: inventoryForecastsTable.recommendedReorderQty,
      confidence: inventoryForecastsTable.confidence,
      forecastDate: inventoryForecastsTable.forecastDate,
    })
    .from(inventoryForecastsTable)
    .innerJoin(productsTable, eq(productsTable.id, inventoryForecastsTable.productId))
    .where(eq(inventoryForecastsTable.productId, productId))
    .orderBy(desc(inventoryForecastsTable.forecastDate))
    .limit(1);
  if (!row) return null;

  // History depth — how many distinct days of orders the product has.
  // Used by the "needs ≥ 14 days" hint in the explanation drawer.
  const histResult = await db.execute(sql`
    SELECT COUNT(DISTINCT DATE(created_at AT TIME ZONE 'UTC'))::int AS days
    FROM orders
    WHERE product_id = ${productId} AND status IN ('pending', 'completed')
  `);
  const histRow = (histResult as unknown as { rows?: Array<{ days: number }> } | Array<{ days: number }>);
  const days = Array.isArray(histRow) ? histRow[0]?.days : histRow.rows?.[0]?.days;

  return {
    productId: row.productId,
    productName: row.productName,
    productImageUrl: row.productImageUrl,
    productSlug: row.productSlug,
    category: row.category,
    currentStockOnHand: row.currentStockOnHand,
    avgDailySales: row.avgDailySales == null ? null : Number(row.avgDailySales),
    dowBlend7d: row.dowBlend7d == null ? null : Number(row.dowBlend7d),
    predictedDemand7d: row.predictedDemand7d,
    predictedDemand30d: row.predictedDemand30d,
    predictedRunoutAt: row.predictedRunoutAt,
    recommendedReorderQty: row.recommendedReorderQty,
    confidence: row.confidence as Confidence,
    forecastDate: row.forecastDate,
    daysOfHistoryAvailable: Number(days ?? 0),
  };
}

/** For the alert dispatcher — rows from the just-completed run that meet the alert predicate. */
export async function selectRunAlertCandidates(runId: number): Promise<
  Array<{
    forecastId: number;
    productId: number;
    productName: string;
    predictedRunoutAt: string;
    currentStockOnHand: number;
    confidence: Confidence;
  }>
> {
  const rows = await db
    .select({
      forecastId: inventoryForecastsTable.id,
      productId: inventoryForecastsTable.productId,
      productName: productsTable.name,
      predictedRunoutAt: inventoryForecastsTable.predictedRunoutAt,
      currentStockOnHand: inventoryForecastsTable.currentStockOnHand,
      confidence: inventoryForecastsTable.confidence,
      forecastDate: inventoryForecastsTable.forecastDate,
    })
    .from(inventoryForecastsTable)
    .innerJoin(productsTable, eq(productsTable.id, inventoryForecastsTable.productId))
    .where(
      and(
        eq(inventoryForecastsTable.runId, runId),
        eq(inventoryForecastsTable.atRisk, true),
        inArray(inventoryForecastsTable.confidence, ["high", "medium"]),
        isNotNull(inventoryForecastsTable.predictedRunoutAt),
      ),
    );
  // Filter to runout within 3 days of the forecast date in JS — Drizzle's
  // date arithmetic across drivers is fiddly, this is the simpler honest path.
  const out: Array<{
    forecastId: number;
    productId: number;
    productName: string;
    predictedRunoutAt: string;
    currentStockOnHand: number;
    confidence: Confidence;
  }> = [];
  for (const r of rows) {
    if (!r.predictedRunoutAt) continue;
    const runoutMs = new Date(`${r.predictedRunoutAt}T00:00:00Z`).getTime();
    const forecastMs = new Date(`${r.forecastDate}T00:00:00Z`).getTime();
    const diffDays = (runoutMs - forecastMs) / 86_400_000;
    if (diffDays >= 0 && diffDays <= 3) {
      out.push({
        forecastId: r.forecastId,
        productId: r.productId,
        productName: r.productName,
        predictedRunoutAt: r.predictedRunoutAt,
        currentStockOnHand: r.currentStockOnHand,
        confidence: r.confidence as Confidence,
      });
    }
  }
  return out;
}

// keep the import used so the type is referenced.
void inventoryForecastRunsTable;
