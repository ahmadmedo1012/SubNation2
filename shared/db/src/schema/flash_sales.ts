import { sql } from "drizzle-orm";
import {
  boolean,
  numeric,
  pgTable,
  serial,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

export const flashSalesTable = pgTable(
  "flash_sales",
  {
    id: serial("id").primaryKey(),
    title: varchar("title", { length: 255 }).notNull().default("Flash Sale"),
    discountPercent: numeric("discount_percent", { precision: 5, scale: 2 })
      .notNull()
      .default("0.00"),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  () => ({
    // At-most-one-ACTIVE-flash-sale invariant — mirrors the live boot
    // SQL. Previously live-only, so a drizzle push dropped it and
    // concurrent active sales became possible (pricing ambiguity).
    // R143 (L9-1): the expression must carry its own parens — a bare
    // `sql`true`` renders as `USING btree (true)`, a 42601 syntax error
    // on real Postgres (index_elem constants must be parenthesized).
    // migrate.ts spells it `((true))`; this form renders identically.
    activeSingleton: uniqueIndex("uniq_flash_sales_active_singleton")
      .on(sql`(true)`)
      .where(sql`is_active = true`),
  }),
);

// R135 (DB-1): insertFlashSaleSchema removed — zero consumers repo-wide
// (grep-verified) along with its drizzle-zod import (the dependency line
// left shared/db/package.json the same round).
export type FlashSale = typeof flashSalesTable.$inferSelect;
