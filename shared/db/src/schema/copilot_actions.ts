import {
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { adminUsersTable } from "./admin_users";
import { copilotPreviewsTable } from "./copilot_previews";

/**
 * Immutable execution record produced by every copilot action — execute,
 * cancel, refusal, validation rejection, rate-limit denial.
 * (010-ai-admin-copilot, data-model.md §1.2.)
 *
 * Pairs with a row in the existing `audit_logs` table for executed actions
 * (`action="copilot.execute"`, `target_type="copilot_action"`,
 * `target_id=<this row's id>`); the dual write happens in one transaction
 * so SC-003 (100% audit coverage) is structurally guaranteed.
 *
 * Refusals/cancellations write only here, not to audit_logs (per
 * data-model.md §R-8): copilot-specific surfaces read this table
 * directly, so non-execute events get full provenance without bloating
 * the cross-feature admin audit view.
 */
export const copilotActionsTable = pgTable(
  "copilot_actions",
  {
    id: serial("id").primaryKey(),
    /**
     * Source preview. NULL when the refusal happened before preview
     * creation (e.g. out-of-scope at intent stage). SET NULL on preview
     * delete so cleanup of expired-then-reaped rows does not orphan-fail.
     */
    previewId: varchar("preview_id", { length: 32 }).references(() => copilotPreviewsTable.id, {
      onDelete: "set null",
    }),
    /** The admin attributed to this action (FR-AUTH-005). */
    adminId: integer("admin_id")
      .notNull()
      .references(() => adminUsersTable.id, { onDelete: "restrict" }),
    /**
     * Verbatim admin input. Duplicated from preview so refusal rows
     * (preview_id NULL) still capture intent text without a join.
     */
    intentText: text("intent_text").notNull(),
    /** Tool the LLM proposed. NULL for refusals at intent stage. */
    toolName: varchar("tool_name", { length: 100 }),
    /**
     * Same vocabulary as `copilot_previews.action_class` plus refusal
     * literals: `refusal`, `validation_rejection`.
     */
    actionClass: varchar("action_class", { length: 50 }).notNull(),
    riskTier: varchar("risk_tier", { length: 20 }).notNull(),
    /**
     * Outcome: success, partial, failure, refused, validation_rejected,
     * rate_limited, stale, expired, cancelled.
     */
    outcome: varchar("outcome", { length: 20 }).notNull(),
    /** Free-text reason populated when outcome is not `success`. */
    failureReason: text("failure_reason"),
    /** Captured snapshot of affected entities pre-execute. */
    beforeState: jsonb("before_state"),
    /**
     * Post-execute snapshot. NULL for non-execute outcomes or for
     * partial/failure where after differs per item (use action_items).
     */
    afterState: jsonb("after_state"),
    confirmedOnceAt: timestamp("confirmed_once_at", { withTimezone: true }),
    confirmedTwiceAt: timestamp("confirmed_twice_at", { withTimezone: true }),
    executedAt: timestamp("executed_at", { withTimezone: true }),
    modelId: varchar("model_id", { length: 64 }),
    modelInputTokens: integer("model_input_tokens"),
    modelOutputTokens: integer("model_output_tokens"),
    correlationId: varchar("correlation_id", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // AUD103-1-F3 (r103): DESC mirrors the boot definition (migrate.ts)
    adminCreatedIdx: index("idx_copilot_actions_admin_created").on(
      t.adminId,
      t.createdAt.desc(),
    ),
    actionClassIdx: index("idx_copilot_actions_action_class").on(t.actionClass),
    outcomeIdx: index("idx_copilot_actions_outcome").on(t.outcome),
    previewIdx: index("idx_copilot_actions_preview").on(t.previewId),
  }),
);
