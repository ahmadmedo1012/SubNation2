import { pgTable, serial, varchar, numeric, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const flashSalesTable = pgTable("flash_sales", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 255 }).notNull().default("Flash Sale"),
  discountPercent: numeric("discount_percent", { precision: 5, scale: 2 })
    .notNull()
    .default("0.00"),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertFlashSaleSchema = createInsertSchema(flashSalesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertFlashSale = z.infer<typeof insertFlashSaleSchema>;
export type FlashSale = typeof flashSalesTable.$inferSelect;
