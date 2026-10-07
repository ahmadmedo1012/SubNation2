import {
  boolean,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const notificationsTable = pgTable(
  "notifications",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 20 }).notNull().default("system"),
    title: varchar("title", { length: 255 }).notNull(),
    message: text("message"),
    link: varchar("link", { length: 255 }),
    isRead: boolean("is_read").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // R120-B6/A6-F3: the notification bell reads
    // WHERE user_id ORDER BY created_at DESC LIMIT 40
    // (routes/notifications.ts) — the old (user_id, is_read) shape only
    // served the user_id prefix and forced a top-N sort on every poll.
    // is_read was never a query predicate there (grep-verified: no
    // consumer filters user_id+is_read together; read-all is user_id-only
    // and stays served by the prefix), so the column is REPLACED by
    // created_at DESC rather than extended (no redundant twin). Same name
    // → the boot twin is the V1-M17-style probe-gated swap in migrate.ts
    // (drop the is_read shape once, create the new shape; steady-state
    // boots send no DDL). Drizzle mirror: 0017.
    userReadIdx: index("idx_notifications_user").on(t.userId, t.createdAt.desc()),
  }),
);

export type Notification = typeof notificationsTable.$inferSelect;
