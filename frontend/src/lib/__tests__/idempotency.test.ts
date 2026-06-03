/**
 * Idempotency-Key generator tests — companion to the F-008 frontend
 * wiring shipped on branch 006.
 *
 * Asserts:
 *   - generateIdempotencyKey() produces an RFC 4122 UUID v4 string
 *   - across N calls the keys are unique (no collisions)
 *   - withIdempotencyKey() is non-mutating and additive
 *
 * The idempotency layer's correctness depends on the keys being:
 *   (a) unique enough that two separate user actions never collide
 *   (b) the right shape (the backend middleware doesn't validate the
 *       UUID structure — it caches against whatever 8+ char string the
 *       client sends — but a malformed string would still log noise
 *       in Sentry's URL-redaction layer and would fail any future
 *       analytics that group on the key)
 *
 * Spec authority: closes the test-coverage half of audit Finding F-008
 * (specs/004-security-audit/security.md F-008 + branch 006 wiring).
 */

import { describe, expect, it, vi } from "vitest";
import { generateIdempotencyKey, withIdempotencyKey } from "../idempotency";

// RFC 4122 UUID v4: 8-4-4-4-12 lowercase hex, the third group's first
// digit is 4, the fourth group's first digit is one of 8/9/a/b.
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("generateIdempotencyKey — primary path (crypto.randomUUID)", () => {
  it("returns a string in canonical UUID v4 shape", () => {
    const key = generateIdempotencyKey();
    expect(key).toMatch(UUID_V4_REGEX);
    expect(key).toHaveLength(36);
  });

  it("returns distinct values across many calls (no collisions)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1_000; i++) {
      seen.add(generateIdempotencyKey());
    }
    // 1000 v4 UUIDs collision-rate is astronomically lower than 1; if
    // we ever see fewer than 1000 unique keys here, the generator is
    // broken — not a flaky test.
    expect(seen.size).toBe(1_000);
  });

  it("two adjacent calls produce different keys", () => {
    expect(generateIdempotencyKey()).not.toBe(generateIdempotencyKey());
  });
});

describe("generateIdempotencyKey — manual fallback path (no crypto.randomUUID)", () => {
  // The fallback path activates when crypto.randomUUID is missing.
  // We force it by stubbing the global crypto object for the duration
  // of these tests; vi.stubGlobal restores after each test.
  it("returns a v4-shaped key from getRandomValues bytes", () => {
    const realCrypto = globalThis.crypto;
    // Mock crypto WITHOUT randomUUID, but with getRandomValues that
    // delegates to the real one so we still get RFC-correct entropy.
    vi.stubGlobal("crypto", {
      getRandomValues: realCrypto.getRandomValues.bind(realCrypto),
    });

    const key = generateIdempotencyKey();
    expect(key).toMatch(UUID_V4_REGEX);
    expect(key).toHaveLength(36);

    vi.unstubAllGlobals();
  });

  it("produces unique keys via the manual path", () => {
    const realCrypto = globalThis.crypto;
    vi.stubGlobal("crypto", {
      getRandomValues: realCrypto.getRandomValues.bind(realCrypto),
    });

    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      seen.add(generateIdempotencyKey());
    }
    expect(seen.size).toBe(500);

    vi.unstubAllGlobals();
  });
});

describe("withIdempotencyKey", () => {
  it("returns a NEW object (non-mutating)", () => {
    const headers = { Authorization: "Bearer abc", "Content-Type": "application/json" };
    const key = generateIdempotencyKey();

    const result = withIdempotencyKey(headers, key);

    expect(result).not.toBe(headers);
    // Source should be untouched — no Idempotency-Key on the input.
    expect("Idempotency-Key" in headers).toBe(false);
  });

  it("preserves all existing headers and adds Idempotency-Key", () => {
    const headers = { Authorization: "Bearer abc", "Content-Type": "application/json" };
    const key = "11111111-2222-4333-8444-555555555555"; // shape-correct fake

    const result = withIdempotencyKey(headers, key);

    expect(result).toEqual({
      Authorization: "Bearer abc",
      "Content-Type": "application/json",
      "Idempotency-Key": key,
    });
  });

  it("does not duplicate when called twice — second call wins", () => {
    // Defines the contract: a caller that re-applies the helper with
    // a different key gets the latter, NOT a malformed multi-value
    // header. This protects against subtle bugs where a wrapper
    // accidentally calls the helper twice.
    const base = withIdempotencyKey({ Authorization: "Bearer abc" }, "first-key");
    const second = withIdempotencyKey(base, "22222222-3333-4444-8555-666666666666");

    expect(second["Idempotency-Key"]).toBe("22222222-3333-4444-8555-666666666666");
    // No accidental duplication in the object.
    expect(Object.keys(second).filter((k) => k.toLowerCase() === "idempotency-key")).toHaveLength(
      1,
    );
  });

  it("works with an empty headers map", () => {
    const result = withIdempotencyKey({}, "abc");
    expect(result).toEqual({ "Idempotency-Key": "abc" });
  });
});
