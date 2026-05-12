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
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { productsTable } from "./products";

export const inventoryTable = pgTable(
  "inventory",
  {
    id: serial("id").primaryKey(),
    productId: integer("product_id")
      .notNull()
      .references(() => productsTable.id, { onDelete: "cascade" }),
    accountEmail: varchar("account_email", { length: 255 }),
    accountPassword: varchar("account_password", { length: 512 }),
    extraDetails: text("extra_details"),
    isSold: boolean("is_sold").notNull().default(false),
    soldAt: timestamp("sold_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    productIdx: index("idx_inventory_product").on(t.productId),
    soldIdx: index("idx_inventory_sold").on(t.isSold),
    productSoldIdx: index("idx_inventory_product_sold").on(t.productId, t.isSold),
  }),
);

export const insertInventorySchema = createInsertSchema(inventoryTable).omit({
  id: true,
  createdAt: true,
});
export type InsertInventory = z.infer<typeof insertInventorySchema>;
export type Inventory = typeof inventoryTable.$inferSelect;
