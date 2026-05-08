import { createHash, randomBytes } from "crypto";

export function hashPassword(password: string): string {
  return createHash("sha256").update(password + "subnation_salt").digest("hex");
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
  const normalized =
    digits.length === 10 && digits.startsWith("0") ? digits.slice(1) : digits;
  if (normalized.length !== 9) return null;
  if (!LIBYAN_PHONE_PREFIXES.some((p) => normalized.startsWith(p))) return null;
  return normalized;
}
