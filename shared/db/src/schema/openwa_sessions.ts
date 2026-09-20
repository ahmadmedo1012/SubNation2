import { customType, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * BYTEA column type — `openwa_sessions.creds` stores raw encrypted
 * session bytes owned by the external OpenWA/Baileys gateway.
 */
const bytea = customType<{ data: Buffer; notNull: true; default: false }>({
  dataType() {
    return "bytea";
  },
});

/**
 * Durable OpenWA/Baileys WhatsApp session credentials.
 *
 * Like `system_settings`, this table existed ONLY via the boot SQL in
 * `backend/src/migrate.ts` (line ~535) with no drizzle schema entry —
 * invisible to snapshots, so `drizzle-kit push` would DROP it with all
 * live gateway credentials. The external gateway reads/writes it through
 * PERSISTENCE_URL; losing it means re-scanning the WhatsApp QR.
 *
 * Keep in lockstep with the boot SQL:
 *   name TEXT PRIMARY KEY, creds BYTEA NOT NULL,
 *   updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
 */
export const openwaSessionsTable = pgTable("openwa_sessions", {
  name: text("name").primaryKey(),
  creds: bytea("creds").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
