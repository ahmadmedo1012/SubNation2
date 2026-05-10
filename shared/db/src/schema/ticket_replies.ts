import { index, integer, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { supportTicketsTable } from "./support_tickets";

export const ticketRepliesTable = pgTable(
  "ticket_replies",
  {
    id: serial("id").primaryKey(),
    ticketId: integer("ticket_id")
      .notNull()
      .references(() => supportTicketsTable.id, { onDelete: "cascade" }),
    authorType: varchar("author_type", { length: 10 }).notNull().default("user"),
    message: text("message").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    ticketIdx: index("idx_replies_ticket").on(t.ticketId, t.createdAt),
  }),
);

export type TicketReply = typeof ticketRepliesTable.$inferSelect;
