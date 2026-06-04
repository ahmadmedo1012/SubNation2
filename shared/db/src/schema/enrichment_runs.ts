import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * Daily catalog-enrichment run record (012-arabic-catalog-enrichment,
 * data-model.md §1.1).
 *
 * One row per cron execution. Powers the panel's "last run" hint, the
 * SC-004 cost auditing, and the daily token-cap accounting.
 */
export const enrichmentRunsTable = pgTable(
  "enrichment_runs",
  {
    id: serial("id").primaryKey(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    /** One of "in_flight", "success", "failure". Mutates exactly once. */
    outcome: varchar("outcome", { length: 20 }).notNull().default("in_flight"),
    /** Drafts that passed validation (FR-DRAFT-007). */
    draftsGenerated: integer("drafts_generated").notNull().default(0),
    /** LLM outputs that failed the validator. */
    draftsInvalid: integer("drafts_invalid").notNull().default(0),
    /** Per-reason skip counts. */
    productsSkipped: jsonb("products_skipped").$type<Record<string, number>>().notNull().default({}),
    /** Cumulative input + output tokens across all LLM calls in this run. */
    tokensSpent: integer("tokens_spent").notNull().default(0),
    /** The cap value at run-start; recorded for reproducible cost back-tests. */
    dailyTokenCap: integer("daily_token_cap").notNull().default(0),
    /** True iff the run halted because cumulative tokens exceeded the cap. */
    capReached: boolean("cap_reached").notNull().default(false),
    workerTier: varchar("worker_tier", { length: 50 }),
    failureReason: text("failure_reason"),
  },
  (t) => ({
    startedAtIdx: index("idx_enrichment_runs_started_at").on(t.startedAt),
    outcomeIdx: index("idx_enrichment_runs_outcome").on(t.outcome, t.startedAt),
  }),
);

export type EnrichmentRun = typeof enrichmentRunsTable.$inferSelect;
export type InsertEnrichmentRun = typeof enrichmentRunsTable.$inferInsert;
