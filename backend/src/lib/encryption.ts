import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { logger } from "./logger";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

/**
 * Parse + validate ENCRYPTION_KEY exactly the way first-use does. Kept as the
 * single validation path for both getKey() and the boot assertion below so
 * the two can never drift.
 */
function parseKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) throw new Error("ENCRYPTION_KEY must be set (32-byte hex string)");
  const buf = Buffer.from(key, "hex");
  if (buf.length !== 32) throw new Error("ENCRYPTION_KEY must be exactly 32 bytes (64 hex chars)");
  return buf;
}

function getKey(): Buffer {
  return parseKey();
}

/**
 * F8 (R98-A6, 98-F5): boot-time fail-fast for ENCRYPTION_KEY.
 *
 * Previously the key was only validated lazily at first encrypt/decrypt
 * (getKey() above): a wiped or typo'd key let the process boot GREEN
 * (healthz 200) while every encrypted-field write 500'd per request and
 * every read silently returned null via safeDecrypt — a half-healthy
 * instance that on Render free never restarts into visibility. Env-loss
 * is this operator's demonstrated failure mode (round-5), so the posture
 * must match SESSION_SECRET (lib/jwt.ts): missing/invalid key = refuse to
 * serve, in dev AND production.
 *
 * Called from server.ts bootstrap() (NOT at module load): migrate.ts
 * deliberately treats the key as optional — it warns and leaves inventory
 * passwords plaintext — and a module-load throw would break that path.
 * Parsing rules are identical to getKey() by construction (shared helper).
 *
 * NOTE for rotation: a NEW key makes previously-encrypted rows
 * undecryptable (safeDecrypt returns null); rotate only together with a
 * re-encryption pass over the inventory-credential columns.
 */
export function assertEncryptionKeyConfigured(): void {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "ENCRYPTION_KEY environment variable is required (exactly 32 bytes of hex / 64 hex " +
        "chars for AES-256-GCM). Set it in your host's environment (the Coolify env panel / " +
        "compose .env; legacy Render: Dashboard → Environment → ENCRYPTION_KEY, sync:false) " +
        "and generate it with `openssl rand -hex 32`. " +
        "Without it every encrypted-field write fails with 500 and every read silently returns " +
        "null — this must fail at boot, not at first use (F8, round-98).",
    );
  }
  const bytes = Buffer.from(raw, "hex").length;
  if (bytes !== 32) {
    throw new Error(
      `ENCRYPTION_KEY must decode to exactly 32 bytes (64 hex chars) for AES-256-GCM; the ` +
        `current value decodes to ${bytes} byte(s). Generate a fresh key with ` +
        "`openssl rand -hex 32` and update it on the host. Rotation note: a changed key makes " +
        "previously-encrypted rows undecryptable (safeDecrypt returns null).",
    );
  }
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
