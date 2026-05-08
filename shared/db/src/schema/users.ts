import { pgTable, serial, varchar, numeric, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  id:            serial("id").primaryKey(),
  phone:         varchar("phone", { length: 20 }).notNull().unique(),
  passwordHash:  varchar("password_hash", { length: 255 }).notNull().default(""),
  googleId:      varchar("google_id", { length: 255 }).unique(),
  githubId:      varchar("github_id", { length: 255 }).unique(),
  facebookId:    varchar("facebook_id", { length: 255 }).unique(),
  telegramId:    varchar("telegram_id", { length: 255 }).unique(),
  walletBalance: numeric("wallet_balance", { precision: 10, scale: 2 }).notNull().default("0.00"),
  loyaltyPoints: integer("loyalty_points").notNull().default(0),
  loyaltyTier:   varchar("loyalty_tier", { length: 50 }).notNull().default("bronze"),
  lifetimeSpend: numeric("lifetime_spend", { precision: 10, scale: 2 }).notNull().default("0.00"),
  referralCode:  varchar("referral_code", { length: 20 }).unique(),
  referredBy:    integer("referred_by"),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
