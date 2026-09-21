import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * Daily inventory-forecast run record (011-inventory-demand-forecast,
 * data-model.md §1.1).
 *
 * One row per execution of the forecast cron. Powers the panel's "last
 * updated" timestamp, the copilot's data_freshness_hours field, and the
 * 14-day capture-rate calibration analysis.
 */
export const inventoryForecastRunsTable = pgTable(
  "inventory_forecast_runs",
  {
    id: serial("id").primaryKey(),
    /** Worker-tier wall-clock at job start. */
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    /** NULL means in-flight or crashed; set on graceful completion. */
    completedAt: timestamp("completed_at", { withTimezone: true }),
    /** One of "in_flight", "success", "failure". Mutates exactly once. */
    outcome: varchar("outcome", { length: 20 }).notNull().default("in_flight"),
    /** Forecasted (non-insufficient-data) products in this run. */
    productsPredicted: integer("products_predicted").notNull().default(0),
    /**
     * Per-reason skip counts:
     * `{insufficient_data: N, archived: M, inactive: K, error: P}`.
     */
    productsSkipped: jsonb("products_skipped")
      .$type<Record<string, number>>()
      .notNull()
      .default({}),
    /** Number of admin_alerts rows the run wrote (≤ 50 by FR-ALERT-005). */
    alertsEmitted: integer("alerts_emitted").notNull().default(0),
    /** True iff the run hit the per-run alert volume cap (FR-ALERT-005). */
    alertsCapped: boolean("alerts_capped").notNull().default(false),
    /** Last computed rolling 14-day capture rate (research §R-8). */
    captureRate14d: numeric("capture_rate_14d", { precision: 4, scale: 3 }),
    /** Forensic tier id captured from process.env.WORKER_TIER_ID. */
    workerTier: varchar("worker_tier", { length: 50 }),
    /** Free-text capture when outcome='failure'. */
    failureReason: text("failure_reason"),
  },
  (t) => ({
    // AUD103-1-F3 (r103): DESC mirrors the boot definition (migrate.ts)
    startedAtIdx: index("idx_forecast_runs_started_at").on(t.startedAt.desc()),
    outcomeIdx: index("idx_forecast_runs_outcome").on(t.outcome, t.startedAt.desc()),
  }),
);
