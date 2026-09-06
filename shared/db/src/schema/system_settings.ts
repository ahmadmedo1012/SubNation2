import { pgTable, varchar, text, timestamp } from "drizzle-orm/pg-core";

/**
 * System settings — key/value store (JSON values).
 *
 * This table was previously created ONLY by the hand-written boot SQL in
 * `backend/src/migrate.ts` (line ~380) and had NO drizzle schema entry.
 * That made it invisible to every generated snapshot, so a
 * `drizzle-kit push` (the script is committed in package.json) would
 * DROP the table and its live data — the classic dual-migration trap.
 * Mirroring it here makes `push` a no-op for this table.
 *
 * Keep column names/types in lockstep with the boot SQL:
 *   key VARCHAR(255) PRIMARY KEY, value TEXT NOT NULL DEFAULT '{}',
 *   updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
 */
export const systemSettingsTable = pgTable("system_settings", {
  key: varchar("key", { length: 255 }).primaryKey(),
  value: text("value").notNull().default("{}"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SystemSetting = typeof systemSettingsTable.$inferSelect;
export type InsertSystemSetting = typeof systemSettingsTable.$inferInsert;
