import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { adminUsersTable } from "./admin_users";
import { enrichmentRunsTable } from "./enrichment_runs";
import { productsTable } from "./products";

/**
 * Per-product, per-field enrichment draft (012-arabic-catalog-enrichment,
 * data-model.md §1.2).
 *
 * Four states: drafted (initial) → published / rejected (terminal),
 * draft_invalid (error sink, never user-facing). The state machine and
 * its CHECK constraints are documented in research §R-7.
 *
 * Apply / reject go through the existing service-layer write path so the
 * customary side effects (slug regeneration, sitemap cache bump, audit
 * log row) all fire.
 */
export const enrichmentDraftsTable = pgTable(
  "enrichment_drafts",
  {
    id: serial("id").primaryKey(),
    runId: integer("run_id")
      .notNull()
      .references((): AnyPgColumn => enrichmentRunsTable.id, { onDelete: "cascade" }),
    productId: integer("product_id")
      .notNull()
      .references((): AnyPgColumn => productsTable.id, { onDelete: "cascade" }),
    /** One of "description", "description_long", "faq". CHECK-constrained. */
    fieldName: varchar("field_name", { length: 50 }).notNull(),
    /** drafted | published | rejected | draft_invalid. CHECK-constrained. */
    state: varchar("state", { length: 20 }).notNull().default("drafted"),
    /** Verbatim LLM output. Always populated, even for draft_invalid rows. */
    generatedText: text("generated_text").notNull(),
    /** Admin's edited version; equals generated_text on apply-without-edit. */
    finalText: text("final_text"),
    modelId: varchar("model_id", { length: 64 }).notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    publishedBy: integer("published_by").references((): AnyPgColumn => adminUsersTable.id, {
      onDelete: "set null",
    }),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    rejectedBy: integer("rejected_by").references((): AnyPgColumn => adminUsersTable.id, {
      onDelete: "set null",
    }),
    rejectionReason: text("rejection_reason"),
    /** Validator findings when state='draft_invalid'. */
    validationErrors: jsonb("validation_errors").$type<Record<string, unknown>>(),
  },
  (t) => ({
    // AUD103-1-F3 (r103): DESC mirrors the boot definition (migrate.ts)
    stateCreatedIdx: index("idx_enrichment_drafts_state_created").on(
      t.state,
      t.createdAt.desc(),
    ),
    productFieldStateIdx: index("idx_enrichment_drafts_product_field_state").on(
      t.productId,
      t.fieldName,
      t.state,
      t.rejectedAt,
    ),
    runIdx: index("idx_enrichment_drafts_run").on(t.runId),
    // R98-DB-03: the four state-machine CHECKs the boot SQL (012 stage)
    // has always applied live; declared via check() so the drizzle chain
    // carries them too (names + expressions pinned verbatim).
    stateCheck: check(
      "chk_enrichment_state",
      sql`state IN ('drafted','published','rejected','draft_invalid')`,
    ),
    fieldCheck: check(
      "chk_enrichment_field",
      sql`field_name IN ('description','description_long','faq')`,
    ),
    publishedConsistencyCheck: check(
      "chk_enrichment_published_consistency",
      sql`(state = 'published') = (published_at IS NOT NULL)`,
    ),
    rejectedConsistencyCheck: check(
      "chk_enrichment_rejected_consistency",
      sql`(state = 'rejected') = (rejected_at IS NOT NULL)`,
    ),
  }),
);
