import argon2 from "argon2";
import { randomBytes } from "crypto";

// OWASP 2024 recommended argon2id parameters:
//   memoryCost: 65536 KiB (64 MiB) — defends against GPU/ASIC cracking
//   timeCost:   3 iterations
//   parallelism: 1
// argon2.needsRehash() (called from verifyPassword) automatically detects
// hashes generated with weaker parameters and flags them for re-hashing on
// next successful login, so a parameter bump self-migrates over time.
const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 1,
};

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

const ARGON2_PREFIX = "$argon2";

/**
 * 98-F3 (R98-A4 P3): pre-computed argon2id hash of a RANDOM 48-byte hex
 * preimage (same ARGON2_OPTIONS as production hashes — identical verify
 * cost; the preimage was generated in a throwaway process and never
 * stored anywhere). Consumers run verifyPassword(password,
 * DUMMY_PASSWORD_HASH) on lookup-miss branches so both the hit and miss
 * paths pay the same ~100 ms argon2 cost — closing the username-
 * existence timing oracle on admin login (routes/admin/auth.ts).
 */
export const DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=65536,t=3,p=1$/uUqxCGaPHJF/dPRMwKORg$SQkBmwGn/yGmQNFndq9fMARN65VxMIPB+NODDM3i0r0";

export interface VerifyPasswordResult {
  valid: boolean;
  needsRehash: boolean;
  /**
   * 98-F3: true when the stored hash is NOT an argon2 hash at all — the
   * legacy SHA-256 fallback was removed (verified live fact: every
   * admin_users row is $argon2id; zero legacy rows exist), so such a row
   * can never validate. The login route surfaces «يلزم إعادة تعيين كلمة
   * المرور» for it — the account is recoverable only via a password
   * reset, not by retrying credentials.
   */
  resetRequired?: boolean;
}

export async function verifyPassword(
  password: string,
  hash: string,
): Promise<VerifyPasswordResult> {
  // Argon2id hash — verify natively
  if (hash.startsWith(ARGON2_PREFIX)) {
    const valid = await argon2.verify(hash, password);
    const needsRehash = valid && argon2.needsRehash(hash, ARGON2_OPTIONS);
    return { valid, needsRehash };
  }
  // 98-F3 (R98-A4 P3): the SHA-256 + static-salt fallback is REMOVED.
  // It only ever covered pre-argon2 rows hashed as
  // sha256(password + "subnation_salt") — trivially crackable offline
  // AND compared non-constant-time. A live inspection (round 98) found
  // ZERO such rows (every admin_users.password_hash starts with
  // $argon2id), and the fallback had no expiry — a row that never logs
  // in would have stayed weak forever. A non-argon2 hash now fails with
  // resetRequired so the route can demand a password reset.
  return { valid: false, needsRehash: false, resetRequired: true };
}

export function generateReferralCode(): string {
  return randomBytes(4).toString("hex").toUpperCase();
}

export function generateOrderCode(): string {
  // F9 (round-94 A4): 48 bits of CSPRNG entropy, not 32. The old
  // 32-bit space hits a ≥1.2% birthday-collision probability at ~10k
  // orders and ~40% at 65k — the first collision tripped
  // orders.order_code UNIQUE as an unclassified 23505 → raw 500 on the
  // purchase path (money-safe: the tx rolled back, but the buyer saw
  // "حدث خطأ"). 2^48 makes a collision negligible at any realistic
  // volume. Same "SN" prefix; orders.order_code is varchar(50) so the
  // 12-hex-digit body still fits.
  return "SN" + randomBytes(6).toString("hex").toUpperCase();
}

export const LIBYAN_PHONE_PREFIXES = ["91", "92", "93", "94"];

/**
 * B5-6 (R111): fold Arabic-Indic digits (٠-٩, U+0660-U+0669) to ASCII
 * 0-9 before validation. Libyans paste phone numbers copied from Arabic
 * UIs; the SPA already converts on the client, but the server accepts
 * them too as defense-in-depth — a stale client, a direct API caller, or
 * a support-forwarded number must not hit «رقم الهاتف غير صالح» for a
 * perfectly valid phone. (Before: \D stripped them as noise → the
 * digit string came out empty/truncated.)
 */
function foldArabicIndicDigits(raw: string): string {
  if (!/[\u0660-\u0669]/.test(raw)) return raw; // fast path — nothing to fold
  return raw.replace(/[\u0660-\u0669]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0x0660 + 0x0030),
  );
}

export function normalizeLibyanPhone(raw: string): string | null {
  const digits = foldArabicIndicDigits(raw).replace(/\D/g, "");
  // 96-F1 (R96-A4 §3.2): accept the international paste forms Libyans
  // actually copy from contacts / WhatsApp profiles. After the
  // digit-strip, shed the international prefix chain BEFORE the
  // 9-digit validation so +218 / 00218 / 218 / 09x / 9x all normalize
  // to the bare local form. Longest prefix first; a leading 0 (trunk)
  // is only shed when exactly 10 digits remain, so a truncated
  // international paste still fails validation honestly.
  let candidate = digits;
  if (candidate.startsWith("00218")) {
    candidate = candidate.slice(5);
  } else if (candidate.startsWith("218")) {
    candidate = candidate.slice(3);
  }
  const normalized =
    candidate.length === 10 && candidate.startsWith("0") ? candidate.slice(1) : candidate;
  if (normalized.length !== 9) return null;
  if (!LIBYAN_PHONE_PREFIXES.some((p) => normalized.startsWith(p))) return null;
  return normalized;
}
