import {
  boolean,
  date,
  index,
  integer,
  numeric,
  pgTable,
  serial,
  timestamp,
  uniqueIndex,
  varchar,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { inventoryForecastRunsTable } from "./inventory_forecast_runs";
import { productsTable } from "./products";

/**
 * Per-product inventory forecast (011-inventory-demand-forecast,
 * data-model.md §1.2).
 *
 * One row per (product, calendar_date). The authoritative snapshot
 * consumed by the admin risk panel, the copilot forecast_demand tool,
 * and the alert dispatcher. Idempotent re-runs upsert on the unique
 * constraint (FR-FORECAST-006); the cron is the only writer.
 *
 * Columns are nullable when `confidence='insufficient_data'` because
 * we refuse to fabricate predictions without ≥ 14 days of order history
 * (FR-FORECAST-003).
 */
export const inventoryForecastsTable = pgTable(
  "inventory_forecasts",
  {
    id: serial("id").primaryKey(),
    runId: integer("run_id")
      .notNull()
      .references((): AnyPgColumn => inventoryForecastRunsTable.id, { onDelete: "cascade" }),
    productId: integer("product_id")
      .notNull()
      .references((): AnyPgColumn => productsTable.id, { onDelete: "cascade" }),
    /** Calendar date the forecast represents (UTC). */
    forecastDate: date("forecast_date").notNull(),
    /** COUNT(inventory.is_sold = false) at run time. */
    currentStockOnHand: integer("current_stock_on_hand").notNull(),
    /** Trailing 14-day mean. NULL when confidence='insufficient_data'. */
    avgDailySales: numeric("avg_daily_sales", { precision: 8, scale: 4 }),
    /** Avg DoW multiplier across the next 7 days. */
    dowBlend7d: numeric("dow_blend_7d", { precision: 8, scale: 4 }),
    predictedDemand7d: integer("predicted_demand_7d"),
    predictedDemand30d: integer("predicted_demand_30d"),
    /** Clamped to [forecast_date, forecast_date + 90 days]. */
    predictedRunoutAt: date("predicted_runout_at"),
    /** max(0, predicted_demand_30d * 1.2 - current_stock_on_hand). */
    recommendedReorderQty: integer("recommended_reorder_qty"),
    /**
     * One of "high", "medium", "low", "insufficient_data". Drives alert
     * eligibility — only high+medium alert (research §R-3).
     */
    confidence: varchar("confidence", { length: 20 }).notNull(),
    /**
     * `predicted_runout_at <= forecast_date + 30 days` AND confidence
     * != insufficient_data. Computed at write time, indexed for the
     * panel's hot path.
     */
    atRisk: boolean("at_risk").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    productDateIdx: index("idx_forecasts_product_date").on(t.productId, t.forecastDate),
    runIdx: index("idx_forecasts_run").on(t.runId),
    productDateUnique: uniqueIndex("uq_forecast_product_date").on(t.productId, t.forecastDate),
  }),
);

export type InventoryForecast = typeof inventoryForecastsTable.$inferSelect;
export type InsertInventoryForecast = typeof inventoryForecastsTable.$inferInsert;
