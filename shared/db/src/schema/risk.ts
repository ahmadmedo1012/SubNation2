/**
 * Anomaly-detection schema (003-anomaly-detection).
 *
 * Implements the four entities defined in
 * `specs/003-anomaly-detection/data-model.md`:
 * `risk_events`, `risk_rules`, `risk_config`, `risk_labels`.
 *
 * Divergence from data-model.md (documented at implementation
 * time): the design doc specs `uuid` PKs, but the project's
 * canonical convention across `users`, `admin_users`,
 * `audit_logs`, etc. is `serial` integer PKs. We follow the
 * project convention so foreign keys, audit-log `targetId`,
 * and codegen pipelines remain uniform. The `data-model.md`
 * uuid notation is read as "stable opaque id" rather than a
 * specific Postgres type.
 */

import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

import { adminUsersTable } from "./admin_users";
import { usersTable } from "./users";

// ---------- Enums ----------------------------------------------------------

export const riskEventTypeEnum = pgEnum("risk_event_type", [
  "login_attempt",
  "login_success",
  "login_failure",
  "otp_request",
  "otp_verify",
  "topup_attempt",
  "topup_success",
  "order_create",
  "order_deliver",
  "coupon_apply",
  "referral_event",
  "admin_force_reauth",
]);

export const riskLevelEnum = pgEnum("risk_level", ["low", "medium", "high", "critical"]);

export const riskActionTakenEnum = pgEnum("risk_action_taken", [
  "none",
  "log",
  "soft_block",
  "hard_block",
  "alert",
]);

export const riskLabelKindEnum = pgEnum("risk_label_kind", [
  "confirmed_fraud",
  "false_positive",
  "escalated",
]);

// ---------- risk_events ----------------------------------------------------

export const riskEventsTable = pgTable(
  "risk_events",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
    eventType: riskEventTypeEnum("event_type").notNull(),
    score: integer("score").notNull(),
    level: riskLevelEnum("level").notNull(),
    confidence: numeric("confidence", { precision: 4, scale: 3 }).notNull(),
    ruleFired: text("rule_fired").array().notNull().default([]),
    statisticalSignals: jsonb("statistical_signals").notNull().default({}),
    mlScore: numeric("ml_score", { precision: 4, scale: 3 }),
    topFeatures: jsonb("top_features"),
    actionTaken: riskActionTakenEnum("action_taken").notNull().default("log"),
    ipAddress: varchar("ip_address", { length: 45 }),
    userAgent: varchar("user_agent", { length: 256 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * First time an admin opened the investigation view for this
     * event. Powers AW-1 (triage time) per spec §9.4 / SC-004.
     */
    shownAt: timestamp("shown_at", { withTimezone: true }),
  },
  (t) => ({
    userCreatedIdx: index("idx_risk_events_user_created").on(t.userId, t.createdAt),
    levelCreatedIdx: index("idx_risk_events_level_created").on(t.level, t.createdAt),
    createdIdx: index("idx_risk_events_created").on(t.createdAt),
    typeCreatedIdx: index("idx_risk_events_type_created").on(t.eventType, t.createdAt),
  }),
);

export type RiskEvent = typeof riskEventsTable.$inferSelect;
export type NewRiskEvent = typeof riskEventsTable.$inferInsert;

// ---------- risk_rules -----------------------------------------------------

export const riskRulesTable = pgTable(
  "risk_rules",
  {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 100 }).notNull().unique(),
    description: text("description").notNull(),
    /**
     * The rule expression in the small DSL (see
     * `data-model.md` §2 and the validator in
     * `backend/src/lib/risk-dsl.ts`). The shape is:
     *   { type: 'and'|'or', clauses: [{field, operator, value}],
     *     score_delta: number }
     * `score_delta` is the contribution to the event's score
     * when the rule fires; T044's synthetic event relies on
     * deterministic deltas to reach `level=critical`.
     */
    expression: jsonb("expression").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    version: integer("version").notNull().default(1),
    createdBy: integer("created_by").references(() => adminUsersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: integer("updated_by").references(() => adminUsersTable.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    nameIdx: index("idx_risk_rules_name").on(t.name),
    enabledIdx: index("idx_risk_rules_enabled").on(t.enabled),
  }),
);

export type RiskRule = typeof riskRulesTable.$inferSelect;
export type NewRiskRule = typeof riskRulesTable.$inferInsert;

// ---------- risk_config (singleton) ---------------------------------------

export const riskConfigTable = pgTable("risk_config", {
  id: integer("id").primaryKey().default(1),
  thresholds: jsonb("thresholds").notNull().default({
    low: 0,
    medium: 30,
    high: 60,
    critical: 85,
  }),
  allowlist: jsonb("allowlist").notNull().default({ ips: [], devices: [], phones: [] }),
  autoBlockEnabled: jsonb("auto_block_enabled").notNull().default({
    softBlock: true,
    hardBlock: false,
    alert: true,
  }),
  /**
   * Per-user require-approval flag set by the
   * `POST /api/admin/risk/users/:id/require-approval` endpoint
   * (T021d). Wallet-topup and order-create routes consult this
   * list and short-circuit to "pending admin approval".
   */
  requireApprovalUserIds: jsonb("require_approval_user_ids").notNull().default([]),
  modelEnabled: boolean("model_enabled").notNull().default(false),
  updatedBy: integer("updated_by").references(() => adminUsersTable.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type RiskConfig = typeof riskConfigTable.$inferSelect;
export type NewRiskConfig = typeof riskConfigTable.$inferInsert;

// ---------- risk_labels ----------------------------------------------------

export const riskLabelsTable = pgTable(
  "risk_labels",
  {
    id: serial("id").primaryKey(),
    riskEventId: integer("risk_event_id").references(() => riskEventsTable.id, {
      onDelete: "set null",
    }),
    label: riskLabelKindEnum("label").notNull(),
    labeledBy: integer("labeled_by").references(() => adminUsersTable.id, {
      onDelete: "set null",
    }),
    labeledAt: timestamp("labeled_at", { withTimezone: true }).notNull().defaultNow(),
    notes: text("notes"),
  },
  (t) => ({
    eventIdx: index("idx_risk_labels_event").on(t.riskEventId),
    labelLabeledAtIdx: index("idx_risk_labels_label_labeled_at").on(t.label, t.labeledAt),
    labeledAtIdx: index("idx_risk_labels_labeled_at").on(t.labeledAt),
  }),
);

export type RiskLabel = typeof riskLabelsTable.$inferSelect;
export type NewRiskLabel = typeof riskLabelsTable.$inferInsert;
