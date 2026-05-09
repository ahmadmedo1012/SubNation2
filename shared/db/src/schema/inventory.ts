import { boolean, integer, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const inventoryTable = pgTable("inventory", {
  id: serial("id").primaryKey(),
  productId: integer("product_id").notNull(),
  accountEmail: varchar("account_email", { length: 255 }),
  accountPassword: varchar("account_password", { length: 512 }),
  extraDetails: text("extra_details"),
  isSold: boolean("is_sold").notNull().default(false),
  soldAt: timestamp("sold_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertInventorySchema = createInsertSchema(inventoryTable).omit({
  id: true,
  createdAt: true,
});
export type InsertInventory = z.infer<typeof insertInventorySchema>;
export type Inventory = typeof inventoryTable.$inferSelect;
