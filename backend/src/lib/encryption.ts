import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { logger } from "./logger";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

function getKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) throw new Error("ENCRYPTION_KEY must be set (32-byte hex string)");
  const buf = Buffer.from(key, "hex");
  if (buf.length !== 32) throw new Error("ENCRYPTION_KEY must be exactly 32 bytes (64 hex chars)");
  return buf;
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Format: iv:authTag:ciphertext (all hex)
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decrypt(ciphertext: string): string {
  const parts = ciphertext.split(":");
  if (parts.length !== 3) throw new Error("Invalid encrypted format");
  const iv = Buffer.from(parts[0], "hex");
  const authTag = Buffer.from(parts[1], "hex");
  const encrypted = Buffer.from(parts[2], "hex");
  const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);
  return decipher.update(encrypted) + decipher.final("utf8");
}

export function isEncrypted(value: string | null): boolean {
  if (!value) return false;
  const parts = value.split(":");
  return (
    parts.length === 3 && parts[0].length === IV_BYTES * 2 && parts[1].length === AUTH_TAG_BYTES * 2
  );
}

export function safeDecrypt(value: string | null): string | null {
  if (!value) return null;
  if (isEncrypted(value)) {
    try {
      return decrypt(value);
    } catch (err) {
      // B2-11 (round-92 audit): GCM auth failure — almost always an
      // ENCRYPTION_KEY mismatch after a rotation that forgot old rows, or
      // a corrupted row. Previously the raw `iv:tag:ct` blob was returned
      // as the buyer's "password": useless credential material shipped to
      // a paying customer with no operational signal beyond this log.
      // Return null instead — the API boundary (formatOrder and friends)
      // already treats null as "credential unavailable", and the buyer
      // sees a proper absence rather than ciphertext garbage. The failing
      // value itself is NOT logged (it is credential material); only a
      // redacted fingerprint (length + format validity) is.
      logger.warn(
        {
          category: "security",
          err,
          valueLength: value.length,
          looksWellFormed: isEncrypted(value),
        },
        "safeDecrypt: decryption failed — returning null (check ENCRYPTION_KEY consistency)",
      );
      return null;
    }
  }
  return value;
}
