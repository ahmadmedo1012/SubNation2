/**
 * Account-link consent tokens — F-003 + CG-08 (security audit 004) closure.
 *
 * Background
 * ----------
 * Before this branch, `resolveFirebaseSession` auto-linked a fresh
 * Firebase identity to an existing SubNation user the moment
 * `findLinkCandidates` returned exactly one match. A targeted attacker
 * who controlled a single provider identity (e.g. a Google account
 * matching a victim's email) was silently linked into the victim's
 * account with no chance for the victim to reject the link.
 *
 * Resolution (S-02 in priorities.md)
 * ----------------------------------
 * Two-phase flow:
 *
 *   1. First call to /api/auth/firebase/session — backend detects a
 *      single link candidate and refuses to commit. It issues a short-
 *      lived consent token bound to (candidate_id, firebase_uid_hash)
 *      and returns it as a 409 Conflict body.
 *
 *   2. The frontend shows the user a confirmation modal naming the
 *      candidate (masked email or phone). On confirm, the frontend
 *      re-submits the same Firebase ID token plus the consent token.
 *
 *   3. Second call — backend consumes the consent token (one-shot via
 *      Redis SET NX + GETDEL), re-runs findLinkCandidates to confirm
 *      the same candidate is still the only match, then performs the
 *      link.
 *
 * Storage
 * -------
 * Redis is the primary store for consent tokens: one-shot via
 * SET NX + GETDEL with a 5-minute TTL.
 *
 * PostgreSQL fallback (round-97 F2, R97-DB-01/A6): the production
 * Redis service is not always present (the round-97 incident had
 * REDIS_URL missing entirely), and the old behaviour — throwing
 * 503 REDIS_UNAVAILABLE at the user mid-link — turned a storage
 * detail into a user-facing outage on the Firebase link flow. When
 * getRedisClient() returns null we now fall back to a small
 * `account_link_consents` table (created lazily, idempotent):
 *
 *   - issue  = INSERT (token, candidate_user_id, firebase_uid_hash,
 *                       now() + 300s)  — token PK, 256-bit random hex.
 *   - consume = DELETE ... WHERE token = $1 AND expires_at > now()
 *               RETURNING candidate_user_id, firebase_uid_hash —
 *               a single atomic statement, so the one-shot property
 *               is exactly as strong as Redis GETDEL: a concurrent
 *               double-consume races on the row delete, and the loser
 *               sees zero rows.
 *   - Expired rows are NOT deleted by consume (they fail the
 *     expires_at predicate); a bounded best-effort sweep runs on ~10%
 *     of consume calls.
 *
 * The comparison after the fetch (candidateUserId + firebaseUidHash)
 * is identical to the Redis path — the fallback only swaps the store.
 * An info line is logged ONCE per process when the fallback first
 * engages (observability without per-request noise).
 *
 * Token shape
 * -----------
 * 32-byte cryptographically-random hex (256 bits of entropy). Stored
 * as the Redis key. The Redis VALUE is a small JSON blob carrying:
 *
 *   - candidateUserId  — the integer SubNation user.id we plan to link
 *   - firebaseUidHash  — SHA-256 of the Firebase UID, so the consent
 *                        cannot be replayed against a different
 *                        Firebase identity. We store the HASH so a
 *                        Redis dump never reveals the raw UID.
 *   - issuedAt         — ISO-8601 timestamp for the audit log.
 *
 * TTL = 5 minutes — long enough for a real user to read the modal and
 * decide; short enough that a stolen browser tab cannot replay the
 * link days later.
 *
 * Security properties
 * -------------------
 * - One-shot: the token is deleted on first consume (GETDEL). A second
 *   call with the same token returns CONSUMED.
 * - Attacker cannot guess: 256-bit entropy, never logged in plaintext.
 * - Attacker cannot redirect to another candidate: the resolver
 *   re-runs findLinkCandidates on the second call and rejects if the
 *   candidate set changed.
 * - Attacker cannot replay against another Firebase identity: the
 *   firebaseUidHash binds the token to the original token holder.
 */

import { createHash, randomBytes } from "crypto";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { getRedisClient, withRedisCommandTimeout } from "./redis-client";
import { logger } from "./logger";

const REDIS_PREFIX = "account-link-consent:";
const TTL_SECONDS = 5 * 60; // 5 minutes
const TOKEN_BYTES = 32; // 256 bits

/** Fraction of consume calls that run the expired-row sweep (R97 F2).
 * Best-effort + bounded: keeps the table from growing forever without
 * adding a deterministic per-request DELETE. */
const PG_SWEEP_PROBABILITY = 0.1;

/** Set once the first PG-fallback call has created the table — avoids
 * re-running idempotent DDL on every issue/consume. */
let pgConsentTableReady = false;

/** Logged exactly once per process when the fallback first engages. */
let pgFallbackLogged = false;

async function ensurePgConsentTable(): Promise<void> {
  if (pgConsentTableReady) return;
  // Single-statement DDL (drizzle's execute uses the prepared-query
  // path which rejects multi-statement strings). IF NOT EXISTS makes
  // concurrent first-calls and re-boots harmless. The official schema
  // registration happens in db/migrate.ts (wave 97-F7).
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS account_link_consents (
      token text PRIMARY KEY,
      candidate_user_id integer NOT NULL,
      firebase_uid_hash text NOT NULL,
      expires_at timestamptz NOT NULL
    )
  `);
  pgConsentTableReady = true;
}

function logPgFallbackOnce(): void {
  if (pgFallbackLogged) return;
  pgFallbackLogged = true;
  logger.info(
    { category: "storage", table: "account_link_consents" },
    "account-link-consent: Redis unavailable — engaging PostgreSQL fallback",
  );
}

export class ConsentTokenError extends Error {
  constructor(
    public statusCode: number,
    public code: ConsentTokenErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ConsentTokenError";
  }
}

export type ConsentTokenErrorCode =
  | "REDIS_UNAVAILABLE"
  | "INVALID_TOKEN"
  | "EXPIRED"
  | "CONSUMED"
  | "CANDIDATE_MISMATCH"
  | "FIREBASE_UID_MISMATCH";

interface ConsentRecord {
  candidateUserId: number;
  firebaseUidHash: string;
  issuedAt: string;
}

function hashFirebaseUid(uid: string): string {
  return createHash("sha256").update(uid).digest("hex");
}

/**
 * Issue a fresh consent token bound to (candidateUserId, firebaseUid).
 * Returns the raw token to embed in the 409 response body.
 *
 * Redis is the primary store; when no Redis client exists the token is
 * persisted in the `account_link_consents` PostgreSQL table instead
 * (round-97 F2 — previously a 503 REDIS_UNAVAILABLE reached the user).
 */
export async function issueConsentToken(opts: {
  candidateUserId: number;
  firebaseUid: string;
}): Promise<string> {
  const redis = getRedisClient();
  if (!redis) {
    return issueConsentTokenViaPg(opts);
  }

  const token = randomBytes(TOKEN_BYTES).toString("hex");
  const record: ConsentRecord = {
    candidateUserId: opts.candidateUserId,
    firebaseUidHash: hashFirebaseUid(opts.firebaseUid),
    issuedAt: new Date().toISOString(),
  };

  // NX ensures we never overwrite an existing token (cryptographically
  // impossible at 256-bit entropy, but defensive). EX sets the TTL.
  // AUD103-8-F2 (r103): bounded — in the documented gray zone (client
  // isReady but socket black-holed) this auth request path used to hang
  // until the HTTP proxy timeout; a command timeout now falls through to
  // the PG-backed variant exactly like the no-client branch.
  let set: string | null = null;
  try {
    set = await withRedisCommandTimeout("consent_issue_set", () =>
      redis.set(`${REDIS_PREFIX}${token}`, JSON.stringify(record), {
        NX: true,
        EX: TTL_SECONDS,
      }),
    );
  } catch (err) {
    logger.warn(
      { err, candidateUserId: opts.candidateUserId },
      "[account-link-consent] Redis issue SET timed out — PG fallback",
    );
    return issueConsentTokenViaPg(opts);
  }
  if (set !== "OK") {
    // Should be unreachable. Treat as a server error rather than
    // silently re-using or weakening the flow.
    logger.error(
      { candidateUserId: opts.candidateUserId },
      "account-link consent token NX collision — Redis reported existing key",
    );
    throw new ConsentTokenError(
      500,
      "REDIS_UNAVAILABLE",
      "تعذّر إصدار رمز التأكيد — حاول مرة أخرى.",
    );
  }

  return token;
}

/**
 * PostgreSQL-backed issuance (Redis absent). INSERT on the token PK —
 * a 23505 unique violation maps to the same cryptographically-
 * impossible 500 branch as the Redis NX miss above.
 */
async function issueConsentTokenViaPg(opts: {
  candidateUserId: number;
  firebaseUid: string;
}): Promise<string> {
  logPgFallbackOnce();
  await ensurePgConsentTable();

  const token = randomBytes(TOKEN_BYTES).toString("hex");
  const expiresAt = new Date(Date.now() + TTL_SECONDS * 1000);

  try {
    await db.execute(sql`
      INSERT INTO account_link_consents (token, candidate_user_id, firebase_uid_hash, expires_at)
      VALUES (${token}, ${opts.candidateUserId}, ${hashFirebaseUid(opts.firebaseUid)}, ${expiresAt})
    `);
  } catch (err) {
    const pgCode =
      err && typeof err === "object" && "code" in err ? (err as { code?: string }).code : undefined;
    if (pgCode === "23505") {
      // 256-bit random hex colliding is not a real branch — treat as a
      // server error, exactly like the Redis NX collision.
      logger.error(
        { candidateUserId: opts.candidateUserId, pgCode },
        "account-link consent token PK collision — INSERT rejected",
      );
      throw new ConsentTokenError(
        500,
        "REDIS_UNAVAILABLE",
        "تعذّر إصدار رمز التأكيد — حاول مرة أخرى.",
      );
    }
    throw err;
  }

  return token;
}

/**
 * Atomically consume a consent token (GET + DEL in one call). Returns
 * the verified candidate user id when:
 *   - the token exists and has not expired,
 *   - the firebase UID hash matches the original issuance,
 *   - the candidate user id matches what the resolver re-computed.
 *
 * The token is deleted on first call regardless of validation outcome
 * (so an attacker cannot retry with corrected fields). Throws
 * ConsentTokenError on any validation miss.
 */
export async function consumeConsentToken(
  token: string,
  expected: {
    candidateUserId: number;
    firebaseUid: string;
  },
): Promise<void> {
  if (!token || typeof token !== "string" || token.length !== TOKEN_BYTES * 2) {
    throw new ConsentTokenError(400, "INVALID_TOKEN", "رمز تأكيد غير صالح.");
  }

  const redis = getRedisClient();
  if (!redis) {
    return consumeConsentTokenViaPg(token, expected);
  }

  const key = `${REDIS_PREFIX}${token}`;
  // Atomic read+delete via Redis 6.2+ GETDEL. If the key is missing,
  // returns null — token expired or already consumed.
  // AUD103-8-F2 (r103): bounded like the issue path; a command timeout
  // falls through to the PG consume (if the Redis GETDEL actually
  // succeeded server-side but the response was lost, the PG row was
  // never written and the user sees the honest "expired" error —
  // far better than hanging the request until the proxy timeout).
  let raw: string | null = null;
  try {
    raw = (await withRedisCommandTimeout("consent_consume_getdel", () => redis.getDel(key))) as
      | string
      | null;
  } catch (err) {
    logger.warn({ err }, "[account-link-consent] Redis consume GETDEL timed out — PG fallback");
    return consumeConsentTokenViaPg(token, expected);
  }
  if (!raw) {
    throw new ConsentTokenError(
      400,
      "EXPIRED",
      "انتهت صلاحية رمز التأكيد أو تم استخدامه. أعد المحاولة من البداية.",
    );
  }

  let record: ConsentRecord;
  try {
    record = JSON.parse(raw) as ConsentRecord;
  } catch {
    throw new ConsentTokenError(400, "INVALID_TOKEN", "رمز تأكيد تالف.");
  }

  if (record.candidateUserId !== expected.candidateUserId) {
    throw new ConsentTokenError(
      409,
      "CANDIDATE_MISMATCH",
      "تغيّر الحساب المرشّح للربط. أعد المحاولة من البداية.",
    );
  }

  if (record.firebaseUidHash !== hashFirebaseUid(expected.firebaseUid)) {
    throw new ConsentTokenError(
      409,
      "FIREBASE_UID_MISMATCH",
      "هوية Firebase لا تطابق رمز التأكيد. أعد المحاولة من البداية.",
    );
  }

  // All checks passed and the key has been deleted. Consent committed.
}

/**
 * PostgreSQL-backed consume (Redis absent). The DELETE ... RETURNING
 * statement is a single atomic operation: the row disappears on the
 * first consume regardless of the subsequent field comparisons, so a
 * failed-validation token is just as dead as a consumed one (same
 * anti-retry property as Redis GETDEL). No row → expired/invalid/
 * already-consumed, indistinguishable by design.
 */
async function consumeConsentTokenViaPg(
  token: string,
  expected: {
    candidateUserId: number;
    firebaseUid: string;
  },
): Promise<void> {
  logPgFallbackOnce();
  await ensurePgConsentTable();

  const result = await db.execute(sql`
    DELETE FROM account_link_consents
    WHERE token = ${token} AND expires_at > now()
    RETURNING candidate_user_id, firebase_uid_hash
  `);
  // node-pg and pglite both hand back a QueryResult-shaped object; the
  // double cast keeps drizzle's generic row type from fighting the
  // narrow shape we selected.
  const rows =
    (
      result as unknown as {
        rows?: Array<{ candidate_user_id: number; firebase_uid_hash: string }>;
      }
    ).rows ?? [];

  // Bounded best-effort sweep of expired rows — runs on ~10% of calls
  // (Math.random), never awaited inline, never throws.
  if (Math.random() < PG_SWEEP_PROBABILITY) {
    void db.execute(sql`DELETE FROM account_link_consents WHERE expires_at <= now()`).catch(() => {
      // best-effort only
    });
  }

  if (rows.length === 0) {
    throw new ConsentTokenError(
      400,
      "EXPIRED",
      "انتهت صلاحية رمز التأكيد أو تم استخدامه. أعد المحاولة من البداية.",
    );
  }

  const record = rows[0]!;

  if (Number(record.candidate_user_id) !== expected.candidateUserId) {
    throw new ConsentTokenError(
      409,
      "CANDIDATE_MISMATCH",
      "تغيّر الحساب المرشّح للربط. أعد المحاولة من البداية.",
    );
  }

  if (record.firebase_uid_hash !== hashFirebaseUid(expected.firebaseUid)) {
    throw new ConsentTokenError(
      409,
      "FIREBASE_UID_MISMATCH",
      "هوية Firebase لا تطابق رمز التأكيد. أعد المحاولة من البداية.",
    );
  }

  // All checks passed and the row is already deleted. Consent committed.
}

/**
 * Mask an email so the modal can name the candidate without leaking
 * full identity. Format: `j••••@example.com`. Preserves the domain
 * (so the user recognises which provider they originally signed up
 * with) and the first character of the local part. A user who knows
 * their own email recognises their account; an attacker who guessed
 * the local part learns only the first character and the domain.
 */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email || typeof email !== "string") return null;
  const at = email.indexOf("@");
  if (at <= 0 || at === email.length - 1) return null;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (local.length < 1) return null;
  // Always render exactly 4 mask dots regardless of original length —
  // prevents the mask from leaking the local-part length.
  return `${local[0]}••••@${domain}`;
}

/**
 * Mask a phone (Libyan local 9-digit format `9XXXXXXXX`) so the modal
 * can name the candidate without leaking full identity. Format:
 * `9•••••••12` — last 2 digits visible, country prefix visible.
 */
export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone || typeof phone !== "string") return null;
  if (phone.length < 4) return null;
  const tail = phone.slice(-2);
  const head = phone.slice(0, 1);
  return `${head}${"•".repeat(Math.max(0, phone.length - 3))}${tail}`;
}
