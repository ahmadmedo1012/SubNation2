import { check, index, integer, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";

/**
 * R191 (backend mobile contracts): Expo push-token registrations.
 *
 * One row per DEVICE registration — `expo_push_token` is the natural key
 * (Expo issues one stable token per app install), so re-registration is an
 * upsert on it: a device that changes hands/logs in as another user
 * transfers ownership (user_id is updated), and logout soft-revokes
 * (revoked_at set; the row stays for audit). NOT a money table — the
 * user FK follows the sessions-table style (ON DELETE CASCADE), not the
 * money tables' RESTRICT family.
 *
 * Boot twin: migrate stage V1-M37 (backend/src/migrate/stages/
 * 05-push-tokens-r191.ts); drizzle mirror: chain 0028.
 */
export const pushTokensTable = pgTable(
  "push_tokens",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    expoPushToken: varchar("expo_push_token", { length: 255 }).notNull().unique(),
    platform: varchar("platform", { length: 16 }).notNull(),
    deviceLabel: varchar("device_label", { length: 255 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => ({
    userIdIdx: index("idx_push_tokens_user_id").on(t.userId),
    platformCheck: check("chk_push_tokens_platform", sql`${t.platform} IN ('android','ios')`),
  }),
);

export type PushToken = typeof pushTokensTable.$inferSelect;
