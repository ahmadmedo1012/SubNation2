import {
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { inventoryTable } from "./inventory";
import { productsTable } from "./products";
import { usersTable } from "./users";

export const orderStatusEnum = pgEnum("order_status", [
  "pending",
  "completed",
  "failed",
  "refunded",
]);

export const ordersTable = pgTable(
  "orders",
  {
    id: serial("id").primaryKey(),
    orderCode: varchar("order_code", { length: 50 }).notNull().unique(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    productId: integer("product_id")
      .notNull()
      .references(() => productsTable.id, { onDelete: "restrict" }),
    inventoryId: integer("inventory_id").references(() => inventoryTable.id, {
      onDelete: "set null",
    }),
    amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
    walletBalanceBefore: numeric("wallet_balance_before", { precision: 10, scale: 2 })
      .notNull()
      .default("0.00"),
    walletBalanceAfter: numeric("wallet_balance_after", { precision: 10, scale: 2 })
      .notNull()
      .default("0.00"),
    status: orderStatusEnum("status").notNull().default("pending"),
    deliveredEmail: varchar("delivered_email", { length: 255 }),
    deliveredPassword: varchar("delivered_password", { length: 255 }),
    deliveredExtraDetails: text("delivered_extra_details"),
    deliveredUsageTerms: text("delivered_usage_terms"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    couponCode: varchar("coupon_code", { length: 50 }),
    discountAmount: numeric("discount_amount", { precision: 10, scale: 2 }).default("0.00"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    userIdx: index("idx_orders_user").on(t.userId),
    productIdx: index("idx_orders_product").on(t.productId),
    statusIdx: index("idx_orders_status").on(t.status),
    createdIdx: index("idx_orders_created").on(t.createdAt),
  }),
);

export const insertOrderSchema = createInsertSchema(ordersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type Order = typeof ordersTable.$inferSelect;
