import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

import { organizationsTable } from "./organizations";

export const usersTable = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").references(() => organizationsTable.id, {
      onDelete: "set null",
    }),
    phone: varchar("phone", { length: 20 }).notNull().unique(),
    googleId: varchar("google_id", { length: 255 }).unique(),
    telegramId: varchar("telegram_id", { length: 255 }).unique(),
    firebaseUid: varchar("firebase_uid", { length: 255 }).unique(),
    email: varchar("email", { length: 255 }),
    emailVerified: boolean("email_verified").notNull().default(false),
    phoneVerified: boolean("phone_verified").notNull().default(false),
    displayName: varchar("display_name", { length: 255 }),
    photoUrl: text("photo_url"),
    /**
     * Origin marker for the user's account (firebase_phone, firebase_google,
     * telegram). Default reflects the most common signup path. Used by
     * admin views for "where did this user come from?" attribution.
     */
    authProvider: varchar("auth_provider", { length: 50 }).notNull().default("firebase_phone"),
    lastAuthAt: timestamp("last_auth_at", { withTimezone: true }),
    walletBalance: numeric("wallet_balance", { precision: 10, scale: 2 }).notNull().default("0.00"),
    loyaltyPoints: integer("loyalty_points").notNull().default(0),
    loyaltyTier: varchar("loyalty_tier", { length: 50 }).notNull().default("bronze"),
    lifetimeSpend: numeric("lifetime_spend", { precision: 10, scale: 2 }).notNull().default("0.00"),
    referralCode: varchar("referral_code", { length: 20 }).unique(),
    referredBy: integer("referred_by").references((): AnyPgColumn => usersTable.id, {
      onDelete: "set null",
    }),
    onboardedAt: timestamp("onboarded_at", { withTimezone: true }),
    onboardingStep: integer("onboarding_step").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    referralCodeIdx: index("idx_users_referral_code").on(t.referralCode),
    referredByIdx: index("idx_users_referred_by").on(t.referredBy),
    // R97-DB-04 (D4 closure, round-97 F7): idx_users_firebase_uid (plain)
    // and idx_users_firebase_uid_unique (partial UNIQUE) were dropped from
    // the live DB and from the boot SQL — both were structural duplicates
    // of the column UNIQUE constraint backing index users_firebase_uid_key
    // (declared by `.unique()` on firebaseUid above), which stays the sole
    // firebase_uid index. Every INSERT previously maintained three btrees
    // on the same column for zero query benefit.
    emailIdx: index("idx_users_email").on(t.email),
    // Round-3 (8-c §4.1): admin users list sorts by createdAt DESC LIMIT 100
    // with no index — sequential scan on every dashboard visit.
    createdIdx: index("idx_users_created").on(t.createdAt),
    // D6 closure (round-97 F7): trigram GIN index over the phone — mirrors
    // the live boot SQL (migrate.ts, created when pg_trgm is available).
    // Powers the admin user-search LIKE '%x%' path. Previously live-only:
    // a drizzle push would have dropped it (same trap idx_products_name_trgm
    // closed earlier — see products.ts for the idiom).
    phoneTrgmIdx: index("idx_users_phone_trgm").using("gin", t.phone.op("gin_trgm_ops")),
  }),
);

export const insertUserSchema = createInsertSchema(usersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type User = typeof usersTable.$inferSelect;
