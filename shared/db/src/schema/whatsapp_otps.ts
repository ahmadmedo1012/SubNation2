import {
  index,
  integer,
  pgTable,
  serial,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * One-time passwords delivered via WhatsApp.
 *
 * Designed as a generic OTP store, not as a registration-only table —
 * the `purpose` field separates registration / login / (future) 2FA
 * concerns so the same code-generation, hashing, expiry, and brute-force
 * machinery serves all three. Only Phase 1 (registration) is wired
 * today; login + 2FA reuse this table when those phases ship.
 *
 * Storage notes:
 *   - `codeHash` is an HMAC-SHA256 of the cleartext OTP, keyed with
 *     `SESSION_SECRET`. We deliberately don't use bcrypt — the codes
 *     are 6-digit numerics with a 5-minute TTL, so the cost of a slow
 *     hash on every verify outweighs the marginal security gain
 *     (brute force is bounded by `attempts` + `expiresAt`). HMAC also
 *     means: an attacker who reads the DB cannot generate forgeries
 *     without `SESSION_SECRET`.
 *   - `attempts` increments on every failed verify; the row is
 *     hard-consumed (consumedAt set) after the cap is hit so the
 *     same code can never be brute-forced piecewise.
 *   - `consumedAt` locks the OTP after a successful verify too,
 *     preventing replay — even by the legitimate user.
 *   - `ipAddress` is recorded for audit / abuse correlation, not for
 *     rate-limiting (rate-limiting reads `createdAt` per-phone).
 *
 * Cleanup: rows can be pruned by a periodic job after 24h. Until then
 * the historical record is useful for the auth_activity correlation
 * the admin security page already shows.
 */
export const whatsappOtpsTable = pgTable(
  "whatsapp_otps",
  {
    id: serial("id").primaryKey(),
    /** Normalized 9-digit Libyan phone (matches users.phone format). */
    phone: varchar("phone", { length: 20 }).notNull(),
    /** HMAC-SHA256(SESSION_SECRET, code + ":" + phone + ":" + purpose). */
    codeHash: varchar("code_hash", { length: 64 }).notNull(),
    /** 'registration' | 'login' | '2fa'  (only 'registration' wired in Phase 1). */
    purpose: varchar("purpose", { length: 32 }).notNull(),
    /** Hard expiry — verifies after this timestamp always reject. */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /** Failed-verify count. Cap at 5 — past that the row is consumed. */
    attempts: integer("attempts").notNull().default(0),
    /** Set once on either successful verify OR brute-force lockout. */
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    /** Audit / abuse correlation. Never used for rate-limiting. */
    ipAddress: varchar("ip_address", { length: 45 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Primary lookup: "find latest unconsumed OTP for this phone+purpose".
    phonePurposeIdx: index("idx_whatsapp_otps_phone_purpose").on(
      t.phone,
      t.purpose,
      t.createdAt,
    ),
    // Used by the cleanup job (drop expired rows).
    expiresAtIdx: index("idx_whatsapp_otps_expires_at").on(t.expiresAt),
  }),
);

export type WhatsappOtp = typeof whatsappOtpsTable.$inferSelect;
