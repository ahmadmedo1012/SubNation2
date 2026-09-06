import { index, pgTable, serial, integer, varchar, text, timestamp, pgEnum } from "drizzle-orm/pg-core";

export const auditActorTypeEnum = pgEnum("audit_actor_type", ["user", "admin", "system"]);

export const auditLogsTable = pgTable(
  "audit_logs",
  {
    id: serial("id").primaryKey(),
    actorId: integer("actor_id"),
    actorType: auditActorTypeEnum("actor_type").notNull().default("system"),
    action: varchar("action", { length: 100 }).notNull(),
    targetType: varchar("target_type", { length: 50 }),
    targetId: integer("target_id"),
    metadata: text("metadata"),
    ip: varchar("ip", { length: 45 }),
    userAgent: varchar("user_agent", { length: 500 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Mirror the four live boot-SQL indexes (previously live-only — a
    // drizzle push dropped them, and the admin audit trail query paths
    // (filter by action / actor / target / recent) went seq-scan).
    actionIdx: index("idx_audit_logs_action").on(t.action),
    actorIdx: index("idx_audit_logs_actor").on(t.actorId, t.actorType),
    targetIdx: index("idx_audit_logs_target").on(t.targetType, t.targetId),
    createdIdx: index("idx_audit_logs_created").on(t.createdAt.desc()),
  }),
);
