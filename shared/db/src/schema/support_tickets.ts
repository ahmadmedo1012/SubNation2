import { index, integer, pgEnum, pgTable, serial, timestamp, varchar } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const ticketStatusEnum = pgEnum("ticket_status", ["open", "in_progress", "closed"]);

export const supportTicketsTable = pgTable(
  "support_tickets",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 255 }).notNull(),
    category: varchar("category", { length: 50 }),
    status: ticketStatusEnum("status").notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    // R123-E5 (V1-M27): idx_tickets_user dropped — superseded by the
    // (user_id, created_at DESC) composite the user tickets list
    // (support.ts) sorts on; boot twin: migrate.ts
    // applyIndexConsolidationStage (probe-gated DROP INDEX IF EXISTS).
    userCreatedIdx: index("idx_tickets_user_created").on(t.userId, t.createdAt.desc()),
    // R120-B6/A6-F4: the admin ticket queue filters status and sorts
    // updated_at DESC (routes/admin/tickets.ts GET /tickets) — only the
    // user-side idx_tickets_user existed, so the queue was a seq scan +
    // top-N sort on every admin poll. (status, updated_at DESC) serves
    // the filtered view; the unfiltered "all" view is a whole-table sort
    // either way (same trade-off as idx_admin_alerts_created, R118-A6
    // F-4). Boot twin: migrate.ts CREATE INDEX IF NOT EXISTS (V1-M24
    // class). Drizzle mirror: 0017.
    statusUpdatedIdx: index("idx_tickets_status_updated").on(t.status, t.updatedAt.desc()),
  }),
);
