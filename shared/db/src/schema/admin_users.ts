import { pgTable, serial, varchar, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const adminUsersTable = pgTable("admin_users", {
  id: serial("id").primaryKey(),
  username: varchar("username", { length: 100 }).notNull().unique(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  displayName: varchar("display_name", { length: 100 }).notNull().default("Admin"),
  role: varchar("role", { length: 50 }).notNull().default("admin"),
  /**
   * Permission scopes granted to this admin. Each entry is one of:
   *
   *   "all"        — wildcard, full access (super admin)
   *   "orders"     — view + manage orders
   *   "finance"    — approve/reject topups, view ledger
   *   "inventory"  — products, stock, pricing, flash sales
   *   "support"    — tickets + alerts
   *   "users"      — user list, referrals
   *   "admins"     — manage other admins, security audit
   *   "settings"   — system settings, observability, diagnostics
   *
   * Existing rows pre-RBAC get backfilled with `["all"]` so current
   * super-admins keep full access. New admins created via the
   * admin-management UI default to a scoped subset; the requirePermission
   * middleware enforces per-route.
   *
   * NOT NULL with a JSONB default `[]` so a forgotten value still
   * produces a well-formed empty array (denies access by default).
   */
  permissions: jsonb("permissions").$type<string[]>().notNull().default([]),
  /**
   * Admin can be soft-disabled without deletion. Disabled admins fail
   * login + the requireAdmin middleware (as if their session expired)
   * but their audit-log history stays intact.
   */
  isActive: boolean("is_active").notNull().default(true),
  totpSecret: varchar("totp_secret", { length: 255 }),
  totpEnabled: boolean("totp_enabled").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAdminUserSchema = createInsertSchema(adminUsersTable).omit({
  id: true,
  createdAt: true,
});
export type InsertAdminUser = z.infer<typeof insertAdminUserSchema>;
export type AdminUser = typeof adminUsersTable.$inferSelect;
