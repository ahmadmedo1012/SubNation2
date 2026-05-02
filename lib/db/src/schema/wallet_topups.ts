import { pgTable, serial, integer, numeric, varchar, text, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const topupStatusEnum = pgEnum("topup_status", ["pending", "approved", "rejected"]);

export const walletTopupsTable = pgTable("wallet_topups", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  paymentMethod: varchar("payment_method", { length: 50 }).notNull().default("mobile_transfer"),
  paymentNetwork: varchar("payment_network", { length: 50 }),
  senderPhone: varchar("sender_phone", { length: 20 }),
  senderAccount: varchar("sender_account", { length: 255 }),
  paymentReference: varchar("payment_reference", { length: 255 }),
  status: topupStatusEnum("status").notNull().default("pending"),
  adminNote: text("admin_note"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertWalletTopupSchema = createInsertSchema(walletTopupsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertWalletTopup = z.infer<typeof insertWalletTopupSchema>;
export type WalletTopup = typeof walletTopupsTable.$inferSelect;
