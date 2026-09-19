import {
  index,
  integer,
  pgTable,
  serial,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { productVariantsTable } from "./product-variants";
import { productsTable } from "./products";

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
    productId: integer("product_id")
      .notNull()
      .references(() => productsTable.id, { onDelete: "cascade" }),
    /**
     * Selected catalog variant for this cart line (product_variants.id).
     * Nullable for legacy rows and for variant-less products. When set,
     * checkout prices + fulfills against that variant.
     */
    variantId: integer("variant_id").references(() => productVariantsTable.id, {
      onDelete: "cascade",
    }),
    /** Display label copy so the cart UI renders the chosen option without joins. */
    variantLabel: varchar("variant_label", { length: 240 }),
    quantity: integer("quantity").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    // UNIQUE, matching the live table (boot SQL creates it as UNIQUE).
    // One row per (user, product): when the shopper selects a DIFFERENT
    // variant of a product already in the server cart, the POST handler
    // updates the line's variant (replace semantics) instead of inserting
    // a second row — deliberately keeping the 2-column invariant the live
    // boot SQL created (no index surgery, no NULL-distinct footgun). The
    // LOCAL cart (the actual purchase driver) keys lines by
    // productId:variantId and can hold several variants of one product.
    userProductUniqueIdx: uniqueIndex("uniq_cart_items_user_product").on(t.userId, t.productId),
    userIdx: index("idx_cart_items_user").on(t.userId),
  }),
);

export type CartItem = typeof cartItemsTable.$inferSelect;
export type InsertCartItem = typeof cartItemsTable.$inferInsert;
