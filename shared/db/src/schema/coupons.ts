import {
  check,
  pgTable,
  serial,
  varchar,
  numeric,
  integer,
  boolean,
  timestamp,
  pgEnum,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const couponTypeEnum = pgEnum("coupon_type", ["percentage", "fixed"]);

export const couponsTable = pgTable(
  "coupons",
  {
    id: serial("id").primaryKey(),
    code: varchar("code", { length: 50 }).notNull().unique(),
    type: couponTypeEnum("type").notNull().default("percentage"),
    value: numeric("value", { precision: 10, scale: 2 }).notNull(),
    minOrderAmount: numeric("min_order_amount", { precision: 10, scale: 2 })
      .notNull()
      .default("0.00"),
    maxUses: integer("max_uses"),
    usedCount: integer("used_count").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    isActive: boolean("is_active").notNull().default(true),
    description: varchar("description", { length: 255 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  () => ({
    // R118-A3 F3: the over-use guard the boot SQL (V1-M9 count-then-add)
    // has always applied live — used_count can never exceed maxUses while
    // max_uses is set. Declared via check() so the drizzle chain +
    // snapshot carries it; name + expression pinned verbatim to the boot
    // SQL (migrate.ts applyMoneyConstraintStage).
    usedLeMaxCheck: check(
      "chk_coupons_used_le_max",
      sql`max_uses IS NULL OR used_count <= max_uses`,
    ),
  }),
);

export type Coupon = typeof couponsTable.$inferSelect;
