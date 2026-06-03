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
 * Redis is the only source of truth for consent tokens. There is NO
 * in-memory fallback: this is a security control, and the production
 * boot path already fail-closes when Redis is configured but
 * unavailable. A dev environment without Redis simply cannot use the
 * link flow until a Redis instance is provided.
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
import { getRedisClient } from "./redis-client";
import { logger } from "./logger";

const REDIS_PREFIX = "account-link-consent:";
const TTL_SECONDS = 5 * 60; // 5 minutes
const TOKEN_BYTES = 32; // 256 bits

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
 * Throws ConsentTokenError(REDIS_UNAVAILABLE) when Redis is missing.
 * Production fail-closes at boot, so this branch is dev/test only —
 * but a dev that hits it sees a clear message instead of a silent
 * fallback to insecure auto-linking.
 */
export async function issueConsentToken(opts: {
  candidateUserId: number;
  firebaseUid: string;
}): Promise<string> {
  const redis = getRedisClient();
  if (!redis) {
    throw new ConsentTokenError(
      503,
      "REDIS_UNAVAILABLE",
      "خدمة ربط الحسابات غير متاحة حالياً (Redis غير مهيأ). حاول لاحقاً.",
    );
  }

  const token = randomBytes(TOKEN_BYTES).toString("hex");
  const record: ConsentRecord = {
    candidateUserId: opts.candidateUserId,
    firebaseUidHash: hashFirebaseUid(opts.firebaseUid),
    issuedAt: new Date().toISOString(),
  };

  // NX ensures we never overwrite an existing token (cryptographically
  // impossible at 256-bit entropy, but defensive). EX sets the TTL.
  const set = await redis.set(`${REDIS_PREFIX}${token}`, JSON.stringify(record), {
    NX: true,
    EX: TTL_SECONDS,
  });
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
    throw new ConsentTokenError(
      503,
      "REDIS_UNAVAILABLE",
      "خدمة ربط الحسابات غير متاحة حالياً (Redis غير مهيأ). حاول لاحقاً.",
    );
  }

  const key = `${REDIS_PREFIX}${token}`;
  // Atomic read+delete via Redis 6.2+ GETDEL. If the key is missing,
  // returns null — token expired or already consumed.
  const raw = (await redis.getDel(key)) as string | null;
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
