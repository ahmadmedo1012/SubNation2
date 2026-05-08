import { pgTable, serial, integer, text, varchar, timestamp } from "drizzle-orm/pg-core";

export const ticketRepliesTable = pgTable("ticket_replies", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").notNull(),
  authorType: varchar("author_type", { length: 10 }).notNull().default("user"),
  message: text("message").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type TicketReply = typeof ticketRepliesTable.$inferSelect;
