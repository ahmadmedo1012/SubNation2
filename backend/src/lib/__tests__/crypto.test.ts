import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "../crypto";

describe("crypto", () => {
  it("should hash a password with argon2id", async () => {
    const password = "TestPassword123";
    const hash = await hashPassword(password);

    expect(hash).toBeDefined();
    expect(hash).not.toBe(password);
    expect(hash.length).toBeGreaterThan(50);
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

  it("should detect legacy SHA-256 hash and indicate rehash needed", async () => {
    // This tests the rehash detection for legacy passwords
    const password = "TestPassword123";
    const hash = await hashPassword(password);

    const result = await verifyPassword(password, hash);

    // New argon2id hashes should not need rehash
    expect(result.needsRehash).toBe(false);
  });
});
