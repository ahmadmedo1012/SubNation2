import { index, integer, pgTable, serial, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Persistent cart — one row per (user, product). Adding the same
 * product twice bumps the quantity instead of creating a duplicate row.
 *
 * Schema mirrors backend/src/migrate.ts CREATE TABLE IF NOT EXISTS —
 * keep both in lockstep when columns change.
 */
export const cartItemsTable = pgTable(
  "cart_items",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    productId: integer("product_id").notNull(),
    quantity: integer("quantity").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    // UNIQUE, matching the live table (boot SQL creates it as UNIQUE).
    // It was previously declared as a plain index while the name said
    // "uniq" — the schema lied about the invariant. One row per
    // (user, product) is what the upsert in the cart routes relies on.
    userProductUniqueIdx: uniqueIndex("uniq_cart_items_user_product").on(t.userId, t.productId),
    userIdx: index("idx_cart_items_user").on(t.userId),
  }),
);

export type CartItem = typeof cartItemsTable.$inferSelect;
export type InsertCartItem = typeof cartItemsTable.$inferInsert;
