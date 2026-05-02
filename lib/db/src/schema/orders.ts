import { pgTable, serial, integer, varchar, numeric, text, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const orderStatusEnum = pgEnum("order_status", ["pending", "completed", "failed", "refunded"]);

export const ordersTable = pgTable("orders", {
  id: serial("id").primaryKey(),
  orderCode: varchar("order_code", { length: 50 }).notNull().unique(),
  userId: integer("user_id").notNull(),
  productId: integer("product_id").notNull(),
  inventoryId: integer("inventory_id"),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  walletBalanceBefore: numeric("wallet_balance_before", { precision: 10, scale: 2 }).notNull().default("0.00"),
  walletBalanceAfter: numeric("wallet_balance_after", { precision: 10, scale: 2 }).notNull().default("0.00"),
  status: orderStatusEnum("status").notNull().default("pending"),
  deliveredEmail: varchar("delivered_email", { length: 255 }),
  deliveredPassword: varchar("delivered_password", { length: 255 }),
  deliveredExtraDetails: text("delivered_extra_details"),
  deliveredUsageTerms: text("delivered_usage_terms"),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertOrderSchema = createInsertSchema(ordersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type Order = typeof ordersTable.$inferSelect;
