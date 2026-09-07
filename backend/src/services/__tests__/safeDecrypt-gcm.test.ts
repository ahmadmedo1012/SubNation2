/**
 * B2-11 (round-92 audit) — safeDecrypt returned the RAW ciphertext blob on
 * GCM auth failure. An ENCRYPTION_KEY rotation that forgot old rows made
 * every affected delivered_password decrypt fail — and the API then
 * returned the literal `iv:tag:ct` string as the buyer's "password".
 *
 * Fix under test: GCM auth failure → null (callers already treat null as
 * "credential unavailable"); legacy plaintext rows and valid ciphertext
 * keep working. ENCRYPTION_KEY is set at module scope before the first
 * encrypt/decrypt call (the key is read lazily per call, not at import).
 */

import { beforeAll, describe, expect, it } from "vitest";

// 32-byte hex key — test-only, never production material. Set before the
// first encrypt/decrypt call (the key is read lazily per call, not at
// import).
process.env.ENCRYPTION_KEY = "11".repeat(32);

import { decrypt, encrypt, isEncrypted, safeDecrypt } from "../../lib/encryption";

beforeAll(() => {
  // Ensure the key stays consistent for the whole suite even if another
  // test file in the same process mutated it.
  process.env.ENCRYPTION_KEY = "11".repeat(32);
});

describe("B2-11: safeDecrypt on GCM authentication failure", () => {
  it("round-trips valid ciphertext (encrypt → safeDecrypt → plaintext)", () => {
    const ct = encrypt("hunter2");
    expect(isEncrypted(ct)).toBe(true);
    expect(safeDecrypt(ct)).toBe("hunter2");
    expect(decrypt(ct)).toBe("hunter2");
  });

  it("tampered ciphertext → null (NOT the raw iv:tag:ct blob)", () => {
    const ct = encrypt("hunter2");
    // Flip the last hex char of the ciphertext body.
    const parts = ct.split(":");
    const body = parts[2];
    const lastChar = body[body.length - 1];
    const flipped = lastChar === "0" ? "1" : "0";
    const tampered = `${parts[0]}:${parts[1]}:${body.slice(0, -1)}${flipped}`;

    expect(isEncrypted(tampered)).toBe(true);
    expect(safeDecrypt(tampered)).toBeNull();
  });

  it("tampered auth tag → null (GCM tag mismatch is an auth failure, not a passthrough)", () => {
    const ct = encrypt("hunter2");
    const parts = ct.split(":");
    const tag = parts[1];
    const tamperedTag = `${tag.slice(0, -1)}${tag[tag.length - 1] === "0" ? "1" : "0"}`;
    const tampered = `${parts[0]}:${tamperedTag}:${parts[2]}`;

    expect(isEncrypted(tampered)).toBe(true);
    expect(safeDecrypt(tampered)).toBeNull();
  });

  it("wrong ENCRYPTION_KEY (rotation that forgot old rows) → null, valid key still decrypts", () => {
    const ct = encrypt("hunter2");
    const original = process.env.ENCRYPTION_KEY;
    try {
      process.env.ENCRYPTION_KEY = "22".repeat(32);
      expect(safeDecrypt(ct)).toBeNull();
    } finally {
      process.env.ENCRYPTION_KEY = original;
    }
    // Restored key decrypts fine — no state pollution.
    expect(safeDecrypt(ct)).toBe("hunter2");
  });

  it("legacy plaintext values pass through unchanged (backward compatibility)", () => {
    expect(safeDecrypt("plain-old-password")).toBe("plain-old-password");
    // Not even encrypted-format — single-segment strings are legacy rows.
    expect(isEncrypted("plain-old-password")).toBe(false);
  });

  it("null/empty input → null", () => {
    expect(safeDecrypt(null)).toBeNull();
    expect(safeDecrypt("")).toBeNull();
  });
});
