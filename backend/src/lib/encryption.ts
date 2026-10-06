import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { logger } from "./logger";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

/**
 * R118-B1c (A4 F-2): version prefix marking blobs minted by the CURRENT
 * ENCRYPTION_KEY. Blobs without it are legacy v1 (`iv:tag:ct`, every
 * pre-R118 row incl. the 15 live credential blobs) and remain decryptable
 * forever — the fallback path below is what makes key rotation survivable.
 */
const V2_PREFIX = "v2:";

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

// B6-03 (R116): memoize the parsed 32-byte key at first use. Env vars are
// immutable per process (mutating process.env.ENCRYPTION_KEY mid-flight has
// never been a supported shape), yet every encrypt/decrypt re-parsed the
// hex string — the credential-heavy surfaces (orders list era, inventory
// reads) paid the parse cost thousands of times per refresh. First failure
// is NOT cached: a throw here propagates exactly as before, so the boot
// assertion + lazy-validation semantics are unchanged.
let memoizedKey: Buffer | null = null;

function getKey(): Buffer {
  if (memoizedKey === null) {
    memoizedKey = parseKey();
  }
  return memoizedKey;
}

/**
 * R118-B1c (A4 F-2), extended R119-B1 (A1 F-1): the DECRYPT-ONLY rotation
 * fallback key.
 *
 * ENCRYPTION_KEY_PREV holds the key that was current before a rotation.
 * ANY blob — v1 (no prefix) or v2 — that fails GCM auth against the
 * current key gets ONE retry against it: during a rotation window a
 * current-key failure means “minted by the previous key before the
 * switch” (mid-rotation material), not “corrupt”. R118's original
 * “v2 blobs never fall back” rationale (“a v2 blob is by construction
 * tied to the key that minted it”) was single-shot — it held only until
 * the FIRST rotation completed and every blob on disk was v2, at which
 * point a SECOND rotation orphaned all of them (R119-A1 finding P1:
 * checkout INVENTORY_CORRUPT, buyer/admin decrypt_failed, admin 2FA
 * locked out behind a misleading wrong-code 401). Optional by design:
 * unset (or malformed — see the warn below) simply means “no fallback”,
 * the exact pre-R118 behaviour. NEVER used for encryption — new writes
 * are always v2 under the current key, so the prev key can be retired
 * once the re-encrypt job (jobs/reencrypt-v1-credentials.ts) has drained
 * every v1 blob AND re-keyed every v2 blob the prev key minted.
 *
 * Memoized like the current key (B6-03); the “memoized: absent” state is
 * tracked separately so a per-process first-use failure shape stays
 * stable (a malformed value warns ONCE, not per call).
 */
let memoizedPrevKey: Buffer | null = null;
let prevKeyMemoized = false;

function getPrevKey(): Buffer | null {
  if (!prevKeyMemoized) {
    prevKeyMemoized = true;
    memoizedPrevKey = null;
    const raw = process.env.ENCRYPTION_KEY_PREV;
    if (raw) {
      const buf = Buffer.from(raw, "hex");
      if (buf.length === 32) {
        memoizedPrevKey = buf;
      } else {
        logger.warn(
          {
            category: "security",
            decodedBytes: buf.length,
          },
          "ENCRYPTION_KEY_PREV is set but does not decode to 32 bytes (64 hex chars) — the rotation fallback is DISABLED for this process; v1 blobs encrypted with the previous key will fail to decrypt (safeDecrypt → null)",
        );
      }
    }
  }
  return memoizedPrevKey;
}

/**
 * Test seam — forget the memoized keys so the NEXT first-use re-parses
 * process.env. Production never calls this (env is immutable per process);
 * tests that simulate a key rotation mid-file use it to model "a new
 * process booting with a different key" (current AND prev keys).
 */
export function __resetEncryptionKeyCacheForTests(): void {
  memoizedKey = null;
  memoizedPrevKey = null;
  prevKeyMemoized = false;
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
 * NOTE for rotation (R118-B1c; extended by R119-B1, A1 F-1): rotation is
 * a REPEATABLE, zero-data-loss procedure —
 *   1. set ENCRYPTION_KEY to the new key and ENCRYPTION_KEY_PREV to the
 *      old one (new writes become v2 blobs under the new key; reads of
 *      old-key material — v1 OR v2 — fall back to PREV),
 *   2. let the re-encrypt one-shot (jobs/reencrypt-v1-credentials.ts)
 *      upgrade every remaining v1 blob to v2 AND re-key every v2 blob
 *      the old key minted (its R119-B1 second pass),
 *   3. once nothing is left that needs PREV, drop ENCRYPTION_KEY_PREV —
 *      and the NEXT rotation starts again at step 1 (N rotations are
 *      supported, not just one).
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
        "`openssl rand -hex 32` and update it on the host. Rotation note: set ENCRYPTION_KEY_PREV " +
        "to the old key before switching, then let the re-encrypt one-shot " +
        "(jobs/reencrypt-v1-credentials.ts) re-key the old key's material " +
        "(v1 and v2) before retiring the old key.",
    );
  }
  // R118-B1c: advisory checks on the OPTIONAL rotation fallback. These
  // WARN rather than throw: a bad ENCRYPTION_KEY_PREV degrades to the
  // exact pre-R118 behaviour (no fallback), which is always bootable —
  // refusing to serve over an optional convenience var would trade a
  // data-availability hint for an outage.
  const prevRaw = process.env.ENCRYPTION_KEY_PREV;
  if (prevRaw) {
    const prevBytes = Buffer.from(prevRaw, "hex").length;
    if (prevBytes !== 32) {
      logger.warn(
        { category: "security", decodedBytes: prevBytes },
        "ENCRYPTION_KEY_PREV is set but does not decode to 32 bytes (64 hex chars) — the rotation fallback is disabled; generate it with `openssl rand -hex 32` (it must be the PREVIOUS key, not a new one)",
      );
    } else if (prevRaw === raw) {
      logger.warn(
        { category: "security" },
        "ENCRYPTION_KEY_PREV equals ENCRYPTION_KEY — the fallback is a no-op (it retries the same key). Set it to the PREVIOUS key, or unset it.",
      );
    }
  }
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Format: v2:iv:authTag:ciphertext (hex after the prefix).
  // R118-B1c (A4 F-2): every NEW blob carries the version prefix so a
  // later rotation can tell current-key blobs from pre-rotation v1 blobs.
  // The +3 chars are inside every current column budget (varchar(512)
  // credential columns hold ~3 extra chars of headroom for any plaintext
  // that fit before; the re-encrypt job length-guards the legacy edge).
  return `${V2_PREFIX}${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

/** Parse the `iv:tag:ct` triple (v1 body, or v2 body after prefix strip). */
function parseSegments(blob: string): { iv: Buffer; authTag: Buffer; encrypted: Buffer } {
  const parts = blob.split(":");
  if (parts.length !== 3) throw new Error("Invalid encrypted format");
  const iv = Buffer.from(parts[0], "hex");
  const authTag = Buffer.from(parts[1], "hex");
  const encrypted = Buffer.from(parts[2], "hex");
  return { iv, authTag, encrypted };
}

/** AES-256-GCM open with a specific key — throws on auth/format failure. */
function decryptSegments(
  segments: { iv: Buffer; authTag: Buffer; encrypted: Buffer },
  key: Buffer,
): string {
  const decipher = createDecipheriv(ALGORITHM, key, segments.iv);
  // Strict tag length (mission W7, semgrep gcm-no-tag-length): only ever
  // accept a full 128-bit GCM tag. Every decrypt funnel — the current key
  // and the PREV fallback, for BOTH blob generations (R119-B1, A1 F-1
  // unified the ladders) — passes through here, so this single gate pins
  // them all. isEncrypted() already enforces the length for values that
  // went through it, but decrypt() is a public entry — a shorter tag
  // reaching setAuthTag would widen the forgery surface.
  if (segments.authTag.length !== AUTH_TAG_BYTES) {
    throw new Error("Invalid auth tag length");
  }
  decipher.setAuthTag(segments.authTag);
  return decipher.update(segments.encrypted) + decipher.final("utf8");
}

/** Parse the `iv:tag:ct` triple out of either generation (v2 = prefix + triple). */
function parseBlobSegments(ciphertext: string): {
  iv: Buffer;
  authTag: Buffer;
  encrypted: Buffer;
} {
  return parseSegments(
    ciphertext.startsWith(V2_PREFIX) ? ciphertext.slice(V2_PREFIX.length) : ciphertext,
  );
}

/** Which configured key opened a blob (see decryptForRotation below). */
export type RotationDecryptStatus = "current" | "prev" | "undecryptable";

export interface RotationDecryptOutcome {
  status: RotationDecryptStatus;
  /** The plaintext for "current"/"prev"; null when undecryptable. */
  plaintext: string | null;
}

/**
 * The shared current→PREV ladder behind decrypt() and decryptForRotation().
 * Current key first (the overwhelming case — in steady state every blob
 * on disk was minted by what is still the current key), then ONE
 * ENCRYPTION_KEY_PREV retry (the rotation window). Reports the winning
 * key so the re-encrypt job can tell “already current” from
 * “mid-rotation material” apart.
 *
 * R119-B1 (A1 F-1, fixing audit finding P3): when BOTH attempts fail (or
 * no fallback is configured), the CURRENT-key error is the one rethrown —
 * the R118 comment promised exactly that, but the unguarded PREV attempt
 * let the PREV error propagate instead. Both failures are equally “wrong
 * key”, yet the current key is the one the operator just set, so its
 * error is the diagnostically honest one (and the shape every pre-R118
 * caller was built around: safeDecrypt → null, decrypt → throws).
 */
function decryptSegmentsWithFallback(segments: {
  iv: Buffer;
  authTag: Buffer;
  encrypted: Buffer;
}): { plaintext: string; source: "current" | "prev" } {
  let currentKeyError: unknown;
  try {
    return { plaintext: decryptSegments(segments, getKey()), source: "current" };
  } catch (err) {
    currentKeyError = err;
  }
  const prevKey = getPrevKey();
  if (prevKey !== null) {
    try {
      return { plaintext: decryptSegments(segments, prevKey), source: "prev" };
    } catch {
      // Both keys failed — fall through to the current-key rethrow.
    }
  }
  throw currentKeyError;
}

export function decrypt(ciphertext: string): string {
  // R119-B1 (A1 F-1): ONE ladder for both blob generations. R118's v2
  // branch ("tied to the key that minted it — no fallback applies") was
  // single-shot: it silently assumed at most one rotation would ever
  // happen, so after the first rotation drained every v1 blob, a SECOND
  // rotation orphaned every v2 blob on disk (checkout refused all sales,
  // reveals degraded, admin 2FA failed behind a wrong-code 401 — R119-A1
  // finding P1). The corrected truth: a v2 blob that fails the current
  // key DURING A ROTATION WINDOW is mid-rotation material — minted by the
  // previous key before the switch — and gets one PREV retry, mirroring
  // v1 exactly. Steady state is unchanged: PREV unset means no fallback,
  // the pre-R118 failure shape (safeDecrypt → null, decrypt → throws).
  return decryptSegmentsWithFallback(parseBlobSegments(ciphertext)).plaintext;
}

/**
 * R119-B1 (A1 F-1): true iff the rotation fallback is ARMED —
 * ENCRYPTION_KEY_PREV is set AND decodes to 32 bytes (a malformed value
 * disables the fallback exactly like an unset one, per getPrevKey). The
 * re-encrypt job's v2 pass gates on this: when false, the pass must not
 * even SCAN the v2 rows — steady-state boot cost stays identical to the
 * R118 ship.
 */
export function isPrevKeyConfigured(): boolean {
  return getPrevKey() !== null;
}

/**
 * R119-B1 (A1 F-1) — tri-state decrypt for the re-encrypt job.
 *
 * decrypt() cannot tell its caller WHICH key won (the fallback is silent
 * by design), yet the job's v2 pass must distinguish three states per
 * row: already minted by the CURRENT key (skip — nothing to do), minted
 * by the PREVIOUS key before a rotation switch (mid-rotation material —
 * re-encrypt under the current key), or dead under every configured key
 * (failed bucket + operator alert — the red flag the v1-only scan of
 * R118 could never see). This seam runs the exact same current→PREV
 * ladder as decrypt() but REPORTS the winning key, and never throws:
 * format garbage, short auth tags and both-keys-dead all collapse to
 * status "undecryptable" (ciphertext-at-rest that no rotation can
 * rescue — only manual key recovery can).
 */
export function decryptForRotation(ciphertext: string): RotationDecryptOutcome {
  try {
    const { plaintext, source } = decryptSegmentsWithFallback(parseBlobSegments(ciphertext));
    return { status: source, plaintext };
  } catch {
    return { status: "undecryptable", plaintext: null };
  }
}

export function isEncrypted(value: string | null): boolean {
  if (!value) return false;
  // v2: the prefix itself is the format marker. Deliberately NOT a
  // segment-length check: a "v2:"-prefixed string that then fails the
  // shape must still be classified as ciphertext-at-rest so decrypt()
  // throws and safeDecrypt() nulls it — treating it as "plaintext" would
  // ship garbage as a credential (the silent-passthrough confusion the
  // R118 edge case forbids). Real plaintext never starts with "v2:"
  // (base32 secrets, emails and human passwords contain no colon-triple
  // with this prefix).
  if (value.startsWith(V2_PREFIX)) return true;
  const parts = value.split(":");
  return (
    parts.length === 3 && parts[0].length === IV_BYTES * 2 && parts[1].length === AUTH_TAG_BYTES * 2
  );
}

/**
 * R118-B1c (A4 F-2): true only for LEGACY v1 blobs — the exact set the
 * re-encrypt job (jobs/reencrypt-v1-credentials.ts) upgrades. v2 blobs,
 * plaintext values and anything v2-prefixed (incl. v2-shaped garbage,
 * which is decrypt-failed material, not upgrade material) all return
 * false.
 */
export function isV1Blob(value: string | null): boolean {
  if (!value) return false;
  if (value.startsWith(V2_PREFIX)) return false;
  return isEncrypted(value);
}

// B6-03 (R116): throttle the safeDecrypt failure warn. A key mismatch or a
// corrupted batch produces the SAME failure for every row — the admin
// orders list era decrypted up to 600 fields per refresh, and each failure
// logged its own warn line: a 600-lines-per-refresh log flood that drowned
// every other signal in the stream (and is exactly what B6-03 removes at
// the source). One warn per window per process now, carrying the count of
// suppressed repeats so the magnitude stays visible. Env-tunable for tests.
let safeDecryptLastWarnAt = 0;
let safeDecryptSuppressedSinceWarn = 0;

/** Test seam — reset the throttle + counter between scenarios. */
export function __resetSafeDecryptWarnThrottleForTests(): void {
  safeDecryptLastWarnAt = 0;
  safeDecryptSuppressedSinceWarn = 0;
}

function safeDecryptWarnThrottleWindowMs(): number {
  const raw = Number(process.env.SAFE_DECRYPT_WARN_THROTTLE_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 60_000;
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
      //
      // B6-03 (R116): one warn line per throttle window — repeated
      // failures are counted, not re-logged (see the block comment above).
      const now = Date.now();
      if (now - safeDecryptLastWarnAt >= safeDecryptWarnThrottleWindowMs()) {
        const suppressed = safeDecryptSuppressedSinceWarn;
        safeDecryptLastWarnAt = now;
        safeDecryptSuppressedSinceWarn = 0;
        logger.warn(
          {
            category: "security",
            err,
            valueLength: value.length,
            looksWellFormed: isEncrypted(value),
            ...(suppressed > 0 ? { suppressed_failures_since_last_warn: suppressed } : {}),
          },
          "safeDecrypt: decryption failed — returning null (check ENCRYPTION_KEY consistency)",
        );
      } else {
        safeDecryptSuppressedSinceWarn += 1;
      }
      return null;
    }
  }
  return value;
}
