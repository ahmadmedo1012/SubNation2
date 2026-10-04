/**
 * F8 (R98-A6, 98-F5) — ENCRYPTION_KEY boot-time fail-fast.
 *
 * The key used to be validated lazily at first encrypt/decrypt (getKey()):
 * a wiped or typo'd key let the process boot GREEN (healthz 200) while every
 * encrypted-field write 500'd per request and every read silently returned
 * null via safeDecrypt — a half-healthy instance that never restarts into
 * visibility on Render free. The exported assertion (called first thing in
 * server.ts bootstrap()) must mirror SESSION_SECRET's posture (lib/jwt.ts —
 * enforced in dev AND prod) and match getKey()'s parsing rules exactly:
 * set AND Buffer.from(hex) of exactly 32 bytes.
 *
 * Mirrors lib/__tests__/jwt-admin-secret.test.ts conventions (delete the
 * var, assert the throw, restore in afterEach).
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  __resetEncryptionKeyCacheForTests,
  assertEncryptionKeyConfigured,
  encrypt,
  decrypt,
} from "../encryption";

const ORIGINAL_KEY = process.env.ENCRYPTION_KEY;

afterEach(() => {
  if (ORIGINAL_KEY === undefined) {
    delete process.env.ENCRYPTION_KEY;
  } else {
    process.env.ENCRYPTION_KEY = ORIGINAL_KEY;
  }
  // B6-03 (R116): the parsed key is memoized at first use — reset between
  // scenarios so each test exercises the fresh-boot validation path.
  __resetEncryptionKeyCacheForTests();
});

describe("assertEncryptionKeyConfigured — F8 boot fail-fast", () => {
  it("missing key throws with a message naming the env var + how to generate it", () => {
    delete process.env.ENCRYPTION_KEY;
    expect(() => assertEncryptionKeyConfigured()).toThrow(/ENCRYPTION_KEY/);
    expect(() => assertEncryptionKeyConfigured()).toThrow(/openssl rand -hex 32/);
    expect(() => assertEncryptionKeyConfigured()).toThrow(/32 bytes/);
  });

  it("empty-string key throws (presence is not enough)", () => {
    process.env.ENCRYPTION_KEY = "";
    expect(() => assertEncryptionKeyConfigured()).toThrow(/ENCRYPTION_KEY/);
  });

  it("non-hex value throws", () => {
    process.env.ENCRYPTION_KEY = "not-hex-at-all-64-characters-padded-to-look-right!!";
    expect(() => assertEncryptionKeyConfigured()).toThrow(/ENCRYPTION_KEY/);
    expect(() => assertEncryptionKeyConfigured()).toThrow(/32 bytes/);
  });

  it("62-char hex (31 bytes) throws — exactly 32 bytes are required", () => {
    process.env.ENCRYPTION_KEY = "11".repeat(31);
    expect(() => assertEncryptionKeyConfigured()).toThrow(/ENCRYPTION_KEY/);
  });

  it("66-char hex (33 bytes) throws", () => {
    process.env.ENCRYPTION_KEY = "11".repeat(33);
    expect(() => assertEncryptionKeyConfigured()).toThrow(/ENCRYPTION_KEY/);
  });

  it("valid 64-char hex key passes the boot assertion", () => {
    process.env.ENCRYPTION_KEY = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
    expect(() => assertEncryptionKeyConfigured()).not.toThrow();
  });

  it("parsing rules stay in lockstep with first use (getKey) — a key the boot accepts, encrypt/decrypt accepts", () => {
    const key = "44".repeat(32);
    process.env.ENCRYPTION_KEY = key;
    expect(() => assertEncryptionKeyConfigured()).not.toThrow();
    const roundtrip = decrypt(encrypt("roundtrip"));
    expect(roundtrip).toBe("roundtrip");
  });

  it("a key the boot rejects is also rejected by first use (no drift)", () => {
    // B6-03 (R116): first-use re-parses after a cache reset, so the
    // lockstep with the boot assertion still holds per boot generation.
    __resetEncryptionKeyCacheForTests();
    process.env.ENCRYPTION_KEY = "zz".repeat(32); // decodes to 0 bytes
    expect(() => assertEncryptionKeyConfigured()).toThrow(/ENCRYPTION_KEY/);
    expect(() => encrypt("x")).toThrow(/ENCRYPTION_KEY/);
  });
});
