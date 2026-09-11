import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Account-link consent tokens — PostgreSQL fallback store (97-F2).
 *
 * `account_link_consents` backs backend/src/lib/account-link-consent.ts
 * when no Redis client exists: the two-phase Firebase link flow (409 +
 * consent modal) issues a short-lived token bound to
 * (candidate_user_id, sha256(firebase_uid)) and consumes it one-shot via
 * `DELETE .. WHERE token = $1 AND expires_at > now() RETURNING …` — the
 * same atomicity as Redis GETDEL (a racing double-consume sees zero
 * rows). Storing the UID HASH keeps a DB dump from revealing raw UIDs.
 *
 * The table is created lazily + idempotently at first fallback use
 * (deploy-order-proof) and is registered canonically by migration V1-M14
 * (backend/src/migrate.ts, applySchedulerLeaseAndConsentTablesStage) with
 * this exact shape — column names/types are pinned VERBATIM between the
 * two sources.
 *
 * Retention: rows live at most ~5 minutes (TTL_SECONDS = 300) plus the
 * best-effort sweep in account-link-consent.ts; expired rows fail the
 * consume predicate and are reaped on ~10% of calls.
 */
export const accountLinkConsentsTable = pgTable("account_link_consents", {
  /** 256-bit cryptographically-random hex — the PK, never logged in plaintext. */
  token: text("token").primaryKey(),
  /** The SubNation user.id the consent plans to link (re-verified on consume). */
  candidateUserId: integer("candidate_user_id").notNull(),
  /** SHA-256 of the Firebase UID — binds the token to one Firebase identity. */
  firebaseUidHash: text("firebase_uid_hash").notNull(),
  /** Expiry (issue time + 5 min); enforced inside the consume DELETE. */
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export type AccountLinkConsent = typeof accountLinkConsentsTable.$inferSelect;
