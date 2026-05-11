import {
  boolean,
  index,
  integer,
  pgTable,
  serial,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const userAuthIdentitiesTable = pgTable(
  "user_auth_identities",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    provider: varchar("provider", { length: 50 }).notNull(),
    providerUid: varchar("provider_uid", { length: 255 }).notNull(),
    firebaseUid: varchar("firebase_uid", { length: 255 }),
    email: varchar("email", { length: 255 }),
    phone: varchar("phone", { length: 20 }),
    emailVerified: boolean("email_verified").notNull().default(false),
    phoneVerified: boolean("phone_verified").notNull().default(false),
    linkedAt: timestamp("linked_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    providerUidIdx: uniqueIndex("idx_user_auth_identities_provider_uid").on(
      t.provider,
      t.providerUid,
    ),
    userIdx: index("idx_user_auth_identities_user").on(t.userId),
    firebaseUidIdx: index("idx_user_auth_identities_firebase_uid").on(t.firebaseUid),
  }),
);

export type UserAuthIdentity = typeof userAuthIdentitiesTable.$inferSelect;
