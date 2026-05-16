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
  return "SN" + randomBytes(4).toString("hex").toUpperCase();
}

export const LIBYAN_PHONE_PREFIXES = ["91", "92", "93", "94"];

export function normalizeLibyanPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  const normalized = digits.length === 10 && digits.startsWith("0") ? digits.slice(1) : digits;
  if (normalized.length !== 9) return null;
  if (!LIBYAN_PHONE_PREFIXES.some((p) => normalized.startsWith(p))) return null;
  return normalized;
}
