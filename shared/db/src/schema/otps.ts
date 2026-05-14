import { index, integer, pgTable, serial, timestamp, varchar } from "drizzle-orm/pg-core";

export const otpsTable = pgTable(
  "otps",
  {
    id: serial("id").primaryKey(),
    phone: varchar("phone", { length: 20 }).notNull(),
    codeHash: varchar("code_hash", { length: 255 }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    phoneIdx: index("idx_otps_phone").on(t.phone),
    expiresIdx: index("idx_otps_expires").on(t.expiresAt),
  }),
);
