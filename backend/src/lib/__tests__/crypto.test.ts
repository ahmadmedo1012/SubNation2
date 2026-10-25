import { describe, it, expect } from "vitest";
import argon2 from "argon2";
import { hashPassword, verifyPassword } from "../crypto";

describe("crypto", () => {
  it("should hash a password with argon2id", async () => {
    const password = "TestPassword123";
    const hash = await hashPassword(password);

    expect(hash).toBeDefined();
    expect(hash).not.toBe(password);
    expect(hash.length).toBeGreaterThan(50);
    // R187 (J-F4): pin the OWASP parameter set itself (crypto.ts
    // ARGON2_OPTIONS) — a silent parameter downgrade would otherwise
    // sail through every behavioral test above. Byte ground truth: this
    // argon2 build emits the PHC params in m,p,t order (the set is
    // m=65536 KiB, t=3, p=1 — crypto.ts's declaration order).
    expect(hash.startsWith("$argon2id$v=19$m=65536,p=1,t=3$")).toBe(true);
  });

  it("should verify a correct password", async () => {
    const password = "TestPassword123";
    const hash = await hashPassword(password);

    const result = await verifyPassword(password, hash);

    expect(result.valid).toBe(true);
  });

  it("should reject an incorrect password", async () => {
    const password = "TestPassword123";
    const wrongPassword = "WrongPassword456";
    const hash = await hashPassword(password);

    const result = await verifyPassword(wrongPassword, hash);

    expect(result.valid).toBe(false);
  });

  it("a FRESH house hash needs no rehash (current parameters)", async () => {
    // R187 (J-F1): retitled from the misleading "legacy SHA-256" claim —
    // this test never constructed a legacy hash; it pins the fresh-hash
    // arm (needsRehash === false on the current parameter set). The
    // non-argon2 and weak-params arms are pinned by the two tests below.
    const password = "TestPassword123";
    const hash = await hashPassword(password);

    const result = await verifyPassword(password, hash);

    expect(result.valid).toBe(true);
    expect(result.needsRehash).toBe(false);
    expect(result.resetRequired).toBeUndefined();
  });

  it("a NON-argon2 stored hash (legacy SHA-256 shape) is invalid and demands a reset — never a rehash", async () => {
    // R187 (J-F1): the crypto.ts:68 arm had zero behavioral coverage —
    // the SHA-256 fallback was removed in round 98, so a stored hash that
    // is not $argon2-prefixed can never validate and must surface
    // resetRequired (the login route's «يلزم إعادة تعيين كلمة المرور»).
    const result = await verifyPassword("TestPassword123", "sha256$deadbeefnotanargon2hash");

    expect(result).toEqual({ valid: false, needsRehash: false, resetRequired: true });
  });

  it("a weak-params argon2id hash validates but flags needsRehash (self-migration)", async () => {
    // R187 (J-F1): the crypto.ts:57 needsRehash arm had zero behavioral
    // coverage — a hash validly produced with weaker parameters
    // (m=1024 KiB, t=1, p=1) verifies fine AND is flagged for re-hashing
    // with the house parameters on that successful login.
    const password = "TestPassword123";
    const weak = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 1024,
      timeCost: 1,
      parallelism: 1,
    });
    expect(weak).toContain("$argon2id$v=19$m=1024,p=1,t=1$");

    const result = await verifyPassword(password, weak);
    expect(result.valid).toBe(true);
    expect(result.needsRehash).toBe(true);
    expect(result.resetRequired).toBeUndefined();
  });
});
