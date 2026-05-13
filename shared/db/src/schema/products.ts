import {
  boolean,
  index,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const productsTable = pgTable(
  "products",
  {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    imageUrl: varchar("image_url", { length: 1000 }),
    price: numeric("price", { precision: 10, scale: 2 }).notNull(),
    category: varchar("category", { length: 100 }),
    isActive: boolean("is_active").notNull().default(true),
    isArchived: boolean("is_archived").notNull().default(false),
    usageTerms: text("usage_terms"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    categoryIdx: index("idx_products_category").on(t.category),
    activeIdx: index("idx_products_active").on(t.isActive),
    archivedIdx: index("idx_products_archived").on(t.isArchived),
    activeCategoryIdx: index("idx_products_active_category").on(t.isActive, t.category),
  }),
);

export const insertProductSchema = createInsertSchema(productsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Product = typeof productsTable.$inferSelect;
