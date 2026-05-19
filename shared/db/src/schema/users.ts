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
import { z } from "zod/v4";

import { organizationsTable } from "./organizations";

export const usersTable = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").references(() => organizationsTable.id, {
      onDelete: "set null",
    }),
    phone: varchar("phone", { length: 20 }).notNull().unique(),
    /**
     * Legacy column from the password era. NULLABLE — new passwordless
     * users (Phone OTP / Google / Telegram) leave this null. Only the
     * legacy_password admin path writes a value. EXISTING rows that
     * were written before the platform went passwordless retain their
     * hashed value; the production migration in migrate.ts drops the
     * NOT NULL constraint without rewriting any data.
     */
    passwordHash: varchar("password_hash", { length: 255 }),
    googleId: varchar("google_id", { length: 255 }).unique(),
    githubId: varchar("github_id", { length: 255 }).unique(),
    facebookId: varchar("facebook_id", { length: 255 }).unique(),
    telegramId: varchar("telegram_id", { length: 255 }).unique(),
    firebaseUid: varchar("firebase_uid", { length: 255 }).unique(),
    email: varchar("email", { length: 255 }),
    emailVerified: boolean("email_verified").notNull().default(false),
    phoneVerified: boolean("phone_verified").notNull().default(false),
    displayName: varchar("display_name", { length: 255 }),
    photoUrl: text("photo_url"),
    /**
     * Default flipped from "legacy_password" to "firebase_phone" — the
     * actual primary auth path. Existing rows are untouched.
     */
    authProvider: varchar("auth_provider", { length: 50 }).notNull().default("firebase_phone"),
    /**
     * Default flipped from true → false. New passwordless users have
     * no password to log in with; only the small set of operator-
     * created legacy accounts have this enabled. Existing rows
     * unchanged.
     */
    passwordLoginEnabled: boolean("password_login_enabled").notNull().default(false),
    legacyPasswordDisabledAt: timestamp("legacy_password_disabled_at", { withTimezone: true }),
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
    firebaseUidIdx: index("idx_users_firebase_uid").on(t.firebaseUid),
    emailIdx: index("idx_users_email").on(t.email),
  }),
);

export const insertUserSchema = createInsertSchema(usersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
