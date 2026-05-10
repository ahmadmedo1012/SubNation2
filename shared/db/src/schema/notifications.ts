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
    userReadIdx: index("idx_notifications_user").on(t.userId, t.isRead),
  }),
);

export type Notification = typeof notificationsTable.$inferSelect;
