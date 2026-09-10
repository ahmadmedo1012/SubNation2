import argon2 from "argon2";
import { createHash, randomBytes } from "crypto";

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

const LEGACY_PREFIX = "$argon2";

export async function verifyPassword(
  password: string,
  hash: string,
): Promise<{ valid: boolean; needsRehash: boolean }> {
  // Argon2id hash — verify natively
  if (hash.startsWith(LEGACY_PREFIX)) {
    const valid = await argon2.verify(hash, password);
    const needsRehash = valid && argon2.needsRehash(hash, ARGON2_OPTIONS);
    return { valid, needsRehash };
  }
  // Legacy SHA-256 hash — verify and flag for migration
  const shaHash = createHash("sha256")
    .update(password + "subnation_salt")
    .digest("hex");
  return { valid: shaHash === hash, needsRehash: shaHash === hash };
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

export function normalizeLibyanPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
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
  const normalized = candidate.length === 10 && candidate.startsWith("0") ? candidate.slice(1) : candidate;
  if (normalized.length !== 9) return null;
  if (!LIBYAN_PHONE_PREFIXES.some((p) => normalized.startsWith(p))) return null;
  return normalized;
}
