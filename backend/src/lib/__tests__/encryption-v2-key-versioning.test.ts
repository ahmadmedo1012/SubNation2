/**
 * R118-B1c (A4 F-2) — encryption key versioning.
 *
 * The blob format gained a version prefix and the decrypt path gained a
 * rotation fallback. The CONTRACT under test (the deploy against the 15
 * live v1 credential blobs must be a no-op until the re-encrypt job runs):
 *
 *   - v1 blobs (no prefix, `iv:tag:ct`, everything on disk today) decrypt
 *     with ENCRYPTION_KEY exactly as before — with OR without
 *     ENCRYPTION_KEY_PREV set;
 *   - new encrypt() output is `v2:iv:tag:ct` and round-trips with the
 *     current key;
 *   - after a rotation (ENCRYPTION_KEY switched, old key parked in
 *     ENCRYPTION_KEY_PREV), v1 blobs made with the OLD key decrypt via
 *     the fallback;
 *   - R119-B1 (A1 F-1): v2 blobs made with the OLD key ALSO decrypt via
 *     the fallback — a v2 blob that fails the current key during a
 *     rotation window is mid-rotation material (minted by the previous
 *     key before the switch), mirroring v1. The R118 pin asserted the
 *     opposite ("v2 never consults PREV") and was single-shot: it held
 *     only until the first rotation drained every v1 blob, at which
 *     point a second rotation orphaned every v2 blob on disk. With PREV
 *     unset — or armed with an UNRELATED key — a v2 blob under a foreign
 *     key still fails cleanly (safeDecrypt → null, decrypt → throws);
 *   - prefix-detection edge cases: a "v2:"-prefixed garbage string is
 *     ciphertext-classified (decrypt throws / safeDecrypt nulls it), never
 *     silently passed through as a "plaintext" credential.
 *
 * Mirrors the env-mutation + __resetEncryptionKeyCacheForTests conventions
 * of safeDecrypt-gcm.test.ts (the memoized key models a per-process boot).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";

const KEY_A = "11".repeat(32); // "current" key for most scenarios
const KEY_B = "22".repeat(32); // the rotated-in / previous key
const KEY_C = "33".repeat(32); // a third key nobody configured

const ORIGINAL_KEY = process.env.ENCRYPTION_KEY;
const ORIGINAL_PREV = process.env.ENCRYPTION_KEY_PREV;

import {
  __resetEncryptionKeyCacheForTests,
  __resetSafeDecryptWarnThrottleForTests,
  decrypt,
  encrypt,
  isEncrypted,
  isV1Blob,
  safeDecrypt,
} from "../encryption";

/** Mint a LEGACY v1 blob (`iv:tag:ct`, no prefix) with an arbitrary key. */
function encryptV1WithKey(plaintext: string, keyHex: string): string {
  const key = Buffer.from(keyHex, "hex");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${ct.toString("hex")}`;
}

beforeEach(() => {
  process.env.ENCRYPTION_KEY = KEY_A;
  delete process.env.ENCRYPTION_KEY_PREV;
  __resetEncryptionKeyCacheForTests();
  __resetSafeDecryptWarnThrottleForTests();
});

afterEach(() => {
  if (ORIGINAL_KEY === undefined) {
    delete process.env.ENCRYPTION_KEY;
  } else {
    process.env.ENCRYPTION_KEY = ORIGINAL_KEY;
  }
  if (ORIGINAL_PREV === undefined) {
    delete process.env.ENCRYPTION_KEY_PREV;
  } else {
    process.env.ENCRYPTION_KEY_PREV = ORIGINAL_PREV;
  }
  __resetEncryptionKeyCacheForTests();
  __resetSafeDecryptWarnThrottleForTests();
});

describe("R118-B1c — v1 backward compatibility (the 15 live blobs)", () => {
  it("a v1 blob decrypts with ENCRYPTION_KEY, no PREV configured (today's exact production shape)", () => {
    const v1 = encryptV1WithKey("hunter2", KEY_A);
    expect(v1.startsWith("v2:")).toBe(false);
    expect(isV1Blob(v1)).toBe(true);
    expect(isEncrypted(v1)).toBe(true);
    expect(decrypt(v1)).toBe("hunter2");
    expect(safeDecrypt(v1)).toBe("hunter2");
  });

  it("a v1 blob decrypts with ENCRYPTION_KEY even when ENCRYPTION_KEY_PREV is set (fallback does not shadow the current key)", () => {
    process.env.ENCRYPTION_KEY_PREV = KEY_B;
    __resetEncryptionKeyCacheForTests();
    const v1 = encryptV1WithKey("hunter2", KEY_A);
    expect(decrypt(v1)).toBe("hunter2");
  });

  it("safeDecrypt still passes legacy plaintext through unchanged", () => {
    expect(safeDecrypt("plain-old-password")).toBe("plain-old-password");
    expect(isV1Blob("plain-old-password")).toBe(false);
    expect(isEncrypted("plain-old-password")).toBe(false);
  });
});

describe("R118-B1c — v2 blob format (new writes)", () => {
  it("encrypt() emits v2:iv:tag:ct and round-trips with the current key", () => {
    const blob = encrypt("v2-roundtrip");
    expect(blob.startsWith("v2:")).toBe(true);
    expect(blob.split(":")).toHaveLength(4);
    expect(blob.split(":")[0]).toBe("v2");
    expect(isEncrypted(blob)).toBe(true);
    expect(isV1Blob(blob)).toBe(false);
    expect(decrypt(blob)).toBe("v2-roundtrip");
    expect(safeDecrypt(blob)).toBe("v2-roundtrip");
  });

  it("R119-B1 (A1 F-1): a v2 blob minted under the PREVIOUS key decrypts via the PREV fallback (mid-rotation material, mirroring v1)", () => {
    // The R118 pin here asserted v2-under-PREV THROWS — wrong by design
    // from the second rotation on. Corrected story: the process used to
    // run KEY_A (every blob it minted is v2-under-A), then rotated —
    // booted with ENCRYPTION_KEY=KEY_B and KEY_A parked in PREV. The
    // v2-under-A blob must decrypt through the fallback exactly like a
    // v1-under-A blob would (rotation #2 survival: checkout, reveals,
    // admin 2FA all keep working mid-rotation).
    process.env.ENCRYPTION_KEY = KEY_B;
    process.env.ENCRYPTION_KEY_PREV = KEY_A;
    __resetEncryptionKeyCacheForTests();
    const midRotationV2 = `v2:${encryptV1WithKey("rotation2-secret", KEY_A)}`;
    expect(isEncrypted(midRotationV2)).toBe(true);
    expect(decrypt(midRotationV2)).toBe("rotation2-secret");
    expect(safeDecrypt(midRotationV2)).toBe("rotation2-secret");
  });

  it("R119-B1 companion: a v2 blob under a foreign key still fails cleanly when PREV is unset — or armed with an unrelated key", () => {
    // Steady state (PREV unset = no fallback, the exact pre-R118 shape) …
    const foreignV2 = `v2:${encryptV1WithKey("foreign", KEY_B)}`; // KEY_A current
    expect(isEncrypted(foreignV2)).toBe(true);
    expect(() => decrypt(foreignV2)).toThrow();
    expect(safeDecrypt(foreignV2)).toBeNull();
    // … and with PREV armed to an UNRELATED third key: the fallback only
    // rescues material the previous key actually minted, never a third
    // generation nobody configured.
    process.env.ENCRYPTION_KEY_PREV = KEY_C;
    __resetEncryptionKeyCacheForTests();
    expect(() => decrypt(foreignV2)).toThrow();
    expect(safeDecrypt(foreignV2)).toBeNull();
  });
});

describe("R118-B1c — rotation fallback (ENCRYPTION_KEY_PREV)", () => {
  it("v1 blob made with the OLD key decrypts after rotation via PREV (decrypt + safeDecrypt)", () => {
    const v1FromOldKey = encryptV1WithKey("pre-rotation-secret", KEY_B);
    process.env.ENCRYPTION_KEY = KEY_A;
    process.env.ENCRYPTION_KEY_PREV = KEY_B;
    __resetEncryptionKeyCacheForTests();

    expect(decrypt(v1FromOldKey)).toBe("pre-rotation-secret");
    expect(safeDecrypt(v1FromOldKey)).toBe("pre-rotation-secret");
  });

  it("without PREV, a v1 blob under a foreign key keeps the legacy failure shape (safeDecrypt null, decrypt throws)", () => {
    const v1FromOldKey = encryptV1WithKey("orphaned-secret", KEY_B);
    // KEY_A current, no PREV — the pre-R118 blind-rotation outcome.
    expect(() => decrypt(v1FromOldKey)).toThrow();
    expect(safeDecrypt(v1FromOldKey)).toBeNull();
  });

  it("the current key stays the only ENCRYPTION key: current-key v2 material decrypts with the fallback dropped (PREV is a read rescue, not a shadow key)", () => {
    process.env.ENCRYPTION_KEY_PREV = KEY_B;
    __resetEncryptionKeyCacheForTests();
    const blob = encrypt("current-key-write");
    // Drop the fallback — the v2 blob must still decrypt (current-key blob).
    delete process.env.ENCRYPTION_KEY_PREV;
    __resetEncryptionKeyCacheForTests();
    expect(decrypt(blob)).toBe("current-key-write");
  });

  it("a malformed ENCRYPTION_KEY_PREV disables the fallback for BOTH generations (no crash, legacy failure shape)", () => {
    process.env.ENCRYPTION_KEY_PREV = "not-hex-at-all-64-characters-padded-to-look-right!!";
    __resetEncryptionKeyCacheForTests();
    const v1FromOldKey = encryptV1WithKey("pre-rotation-secret", KEY_B);
    expect(() => decrypt(v1FromOldKey)).toThrow();
    expect(safeDecrypt(v1FromOldKey)).toBeNull();
    // R119-B1 (A1 F-1): the v2 fallback path is the same ladder — a
    // malformed PREV disarms it identically (getPrevKey → null).
    const v2FromOldKey = `v2:${encryptV1WithKey("pre-rotation-secret", KEY_B)}`;
    expect(() => decrypt(v2FromOldKey)).toThrow();
    expect(safeDecrypt(v2FromOldKey)).toBeNull();
    // Current-key v1 blobs are unaffected by the bad fallback value.
    expect(decrypt(encryptV1WithKey("fine", KEY_A))).toBe("fine");
  });

  it("current-key v1 blobs take the fast path: fallback is only attempted after a real GCM failure", () => {
    process.env.ENCRYPTION_KEY_PREV = KEY_B;
    __resetEncryptionKeyCacheForTests();
    // Tampered v1 blob: fails current key, fails prev key → throws the
    // CURRENT-key error. R119-B1 (A1 F-1, audit finding P3): the PREV
    // attempt is now guarded, so the current-key error is genuinely the
    // one rethrown (R118 let the prev error propagate instead). Node's
    // GCM auth-failure message is identical for both keys, so the
    // assertion stays shape-based (throws / safeDecrypt → null).
    const v1 = encryptV1WithKey("hunter2", KEY_A);
    const parts = v1.split(":");
    const body = parts[2];
    const flipped = `${body[body.length - 1] === "0" ? "1" : "0"}`;
    const tampered = `${parts[0]}:${parts[1]}:${body.slice(0, -1)}${flipped}`;
    expect(() => decrypt(tampered)).toThrow();
    expect(safeDecrypt(tampered)).toBeNull();
    // Same both-keys-dead shape for a TAMPERED v2 blob (the unified
    // ladder covers both generations).
    const v2 = encrypt("hunter2");
    const v2Parts = v2.split(":");
    const v2Body = v2Parts[3];
    const v2Flipped = `${v2Body[v2Body.length - 1] === "0" ? "1" : "0"}`;
    const tamperedV2 = `${v2Parts[0]}:${v2Parts[1]}:${v2Parts[2]}:${v2Body.slice(0, -1)}${v2Flipped}`;
    expect(() => decrypt(tamperedV2)).toThrow();
    expect(safeDecrypt(tamperedV2)).toBeNull();
  });
});

describe("R118-B1c — prefix-detection edge cases (never a silent passthrough)", () => {
  it('"v2:" + garbage segments → decrypt throws, safeDecrypt nulls (clean failure, not a "plaintext" passthrough)', () => {
    const garbage = "v2:garbage:stuff:here";
    expect(isEncrypted(garbage)).toBe(true);
    expect(isV1Blob(garbage)).toBe(false);
    expect(() => decrypt(garbage)).toThrow();
    expect(safeDecrypt(garbage)).toBeNull();
  });

  it('"v2:" + well-shaped hex that fails GCM auth → null, not garbage', () => {
    const foreignBody = encryptV1WithKey("x", KEY_C); // wrong key, right shape
    const fakeV2 = `v2:${foreignBody}`;
    expect(isEncrypted(fakeV2)).toBe(true);
    expect(safeDecrypt(fakeV2)).toBeNull();
  });

  it('"v2:" with the wrong segment COUNT throws the format error (not a passthrough)', () => {
    expect(() => decrypt("v2:onlyonesegment")).toThrow(/Invalid encrypted format/);
    expect(safeDecrypt("v2:onlyonesegment")).toBeNull();
  });

  it("a plaintext value that merely CONTAINS v2: mid-string is not v2-classified", () => {
    const mid = `note-${encrypt("x")}-suffix`; // contains, does not start with
    expect(isEncrypted(mid)).toBe(false);
    expect(safeDecrypt(mid)).toBe(mid); // plaintext passthrough (unchanged rule)
  });

  it("v1 detection stays exact: 3 segments with 24/32-char hex heads", () => {
    expect(isV1Blob(encryptV1WithKey("p", KEY_A))).toBe(true);
    expect(isV1Blob("a:b:c")).toBe(false); // colon-triple, wrong lengths
    expect(isV1Blob("24charsofstuff:32charsofstuffix:ct")).toBe(false); // right lengths, non-hex heads
    expect(isV1Blob(null)).toBe(false);
    expect(isV1Blob("")).toBe(false);
  });
});

describe("R118-B1c — boot assertion advisories for ENCRYPTION_KEY_PREV", () => {
  // The boot assertion's ENCRYPTION_KEY semantics are pinned by
  // encryption-boot-assert.test.ts; here only the NEW advisory warns.
  it("valid PREV does not throw at boot", async () => {
    process.env.ENCRYPTION_KEY = KEY_A;
    process.env.ENCRYPTION_KEY_PREV = KEY_B;
    const { assertEncryptionKeyConfigured } = await import("../encryption");
    expect(() => assertEncryptionKeyConfigured()).not.toThrow();
  });
});
