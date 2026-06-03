import { index, integer, jsonb, pgTable, serial, text, varchar } from "drizzle-orm/pg-core";
import { copilotActionsTable } from "./copilot_actions";

/**
 * Per-item outcomes for bulk copilot executes (FR-BULK-004).
 *
 * One row per affected entity in a bulk action. Cascade-deletes with the
 * parent `copilot_actions` row; per-item rows have no audit value if the
 * parent is gone, and parent deletion only happens via data-correction
 * migration anyway.
 */
export const copilotActionItemsTable = pgTable(
  "copilot_action_items",
  {
    id: serial("id").primaryKey(),
    actionId: integer("action_id")
      .notNull()
      .references(() => copilotActionsTable.id, { onDelete: "cascade" }),
    entityType: varchar("entity_type", { length: 50 }).notNull(),
    entityId: integer("entity_id").notNull(),
    /** `success`, `failure`, `skipped`. */
    outcome: varchar("outcome", { length: 20 }).notNull(),
    failureReason: text("failure_reason"),
    /** Field-level before snapshot for this single item. */
    beforeValue: jsonb("before_value"),
    /** Field-level after snapshot for this single item. */
    afterValue: jsonb("after_value"),
  },
  (t) => ({
    actionIdx: index("idx_copilot_action_items_action").on(t.actionId),
    entityIdx: index("idx_copilot_action_items_entity").on(t.entityType, t.entityId),
  }),
);

export type CopilotActionItem = typeof copilotActionItemsTable.$inferSelect;
export type InsertCopilotActionItem = typeof copilotActionItemsTable.$inferInsert;
