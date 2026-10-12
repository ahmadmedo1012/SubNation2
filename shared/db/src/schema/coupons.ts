import {
  check,
  index,
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
  (t) => ({
    // R135 (DB-1 / V1-M34): the couponWatcher expiry scans
    // (jobs/couponWatcher.ts checkExpiringCoupons) — BOTH arms filter
    // expires_at IS NOT NULL (the auto-disable UPDATE's
    // `expires_at < now()` arm and the 24h-warning SELECT's
    // `expires_at BETWEEN now() AND now()+24h` arm), so the partial
    // predicate indexes exactly the scanned minority slice while
    // no-expiry coupons (the majority) never pay the per-INSERT write
    // cost — the idx_admin_sessions_revoked_at (V1-M31) partial idiom.
    // Boot twin: migrate.ts applyR135IndexWaveStage (V1-M34, additive
    // CREATE INDEX IF NOT EXISTS form); drizzle mirror: chain 0023.
    expiresAtIdx: index("idx_coupons_expires_at")
      .on(t.expiresAt)
      .where(sql`expires_at IS NOT NULL`),
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
