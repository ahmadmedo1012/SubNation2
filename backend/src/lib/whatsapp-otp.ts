/**
 * WhatsApp OTP — pure crypto helpers.
 *
 * Pure module. No DB, no Express, no env reads, no logger. Trivial to
 * unit-test (see __tests__/whatsapp-otp.test.ts). The orchestration
 * layer (services/whatsapp-otp.service.ts) is what reads env, talks
 * to the DB, and dispatches via the OpenWA gateway — this module
 * is concerned only with code generation, hashing, and verification.
 *
 * Design notes:
 *
 *   - Codes are 6 numeric digits (1,000,000 keyspace). With a 5-minute
 *     TTL, a 5-attempt cap per code, and per-phone send rate-limits
 *     (1/60s, 5/h) the brute-force probability is well below 0.001%.
 *
 *   - We use `randomInt` (CSPRNG) instead of Math.random — never reach
 *     for the latter for security-critical values.
 *
 *   - Hash = HMAC_SHA256(secret, code + ":" + phone + ":" + purpose).
 *     The phone+purpose binding prevents a hash leaked from one record
 *     from validating against a different (phone, purpose) tuple.
 *
 *   - timingSafeEqual is used for the comparison to defeat timing
 *     side channels.
 */

import { createHmac, randomInt, timingSafeEqual } from "crypto";

/** Length of the OTP in digits. 6 is the WhatsApp/SMS-OTP industry standard. */
export const OTP_LENGTH = 6;

/** Default TTL for a freshly-issued code. */
export const OTP_TTL_SEC = 5 * 60;

/** Per-code failed-attempt cap before the row is hard-consumed. */
export const OTP_MAX_ATTEMPTS = 5;

/** Soft cooldown between two `start` requests for the same phone. */
export const OTP_RESEND_COOLDOWN_SEC = 60;

/** Hard hourly send cap per phone (across all `purpose` values). */
export const OTP_HOURLY_LIMIT = 5;

/**
 * Identifies the surface that requested this code. The orchestration
 * service uses it to route to the correct find-or-create logic on
 * verify success. `2fa` is reserved for the next phase but the field
 * already accepts it so no migration is needed when 2FA ships.
 */
export type OtpPurpose = "registration" | "login" | "2fa";

/**
 * Generate a fresh random OTP. Padded to OTP_LENGTH so leading zeros
 * are preserved when displayed.
 */
export function generateOtp(): string {
  const max = 10 ** OTP_LENGTH;
  return String(randomInt(0, max)).padStart(OTP_LENGTH, "0");
}

/**
 * Hash an OTP for storage / comparison.
 *
 * Binds the hash to (code, phone, purpose) so a leaked hash row can
 * only validate against the exact tuple it was issued for.
 */
export function hashOtp(
  code: string,
  phone: string,
  purpose: OtpPurpose,
  secret: string,
): string {
  if (!secret) throw new Error("hashOtp: secret is required");
  const message = `${code}:${phone}:${purpose}`;
  return createHmac("sha256", secret).update(message).digest("hex");
}

/**
 * Constant-time hash compare. Both inputs MUST be hex strings of the
 * same length for `timingSafeEqual` to operate; if they're not, return
 * false without throwing.
 */
export function compareOtpHash(provided: string, stored: string): boolean {
  try {
    const a = Buffer.from(provided, "hex");
    const b = Buffer.from(stored, "hex");
    if (a.length === 0 || a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Validate a user-submitted code against a stored row in one call.
 * Caller still owns the side effects (incrementing attempts, marking
 * consumed) — this function does only the read-only checks.
 */
export interface OtpRow {
  codeHash: string;
  phone: string;
  purpose: OtpPurpose;
  expiresAt: Date;
  attempts: number;
  consumedAt: Date | null;
}

export type OtpVerifyResult =
  | { ok: true }
  | {
      ok: false;
      reason: "consumed" | "expired" | "exhausted" | "mismatch";
    };

export function verifyOtp(
  submittedCode: string,
  row: OtpRow,
  secret: string,
  options: { now?: Date } = {},
): OtpVerifyResult {
  const now = options.now ?? new Date();
  if (row.consumedAt) return { ok: false, reason: "consumed" };
  if (row.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: "expired" };
  if (row.attempts >= OTP_MAX_ATTEMPTS) return { ok: false, reason: "exhausted" };
  if (!/^\d+$/.test(submittedCode) || submittedCode.length !== OTP_LENGTH) {
    return { ok: false, reason: "mismatch" };
  }
  const expected = hashOtp(submittedCode, row.phone, row.purpose, secret);
  if (!compareOtpHash(expected, row.codeHash)) return { ok: false, reason: "mismatch" };
  return { ok: true };
}
