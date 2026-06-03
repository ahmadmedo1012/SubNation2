/**
 * Account-link consent token tests — F-003 (security audit 004).
 *
 * Asserts the security properties of the issue/consume cycle:
 *   - tokens are 256 bits of entropy, hex-encoded
 *   - one-shot via Redis GETDEL (second consume returns EXPIRED)
 *   - consume rejects when candidateUserId differs from issuance
 *   - consume rejects when firebaseUid differs from issuance
 *   - issue throws REDIS_UNAVAILABLE when Redis is null
 *   - maskEmail / maskPhone produce hint-not-disclosure output
 *
 * Uses an in-memory Redis stub (no real network) so the test suite
 * stays hermetic. The stub mirrors the small subset of API the module
 * actually exercises: SET (with NX + EX), GETDEL.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Minimal in-memory Redis stub. Only implements what
// account-link-consent.ts uses today (set / getDel). Returns are typed
// loosely to match node-redis's runtime shape.
type RedisStub = {
  storage: Map<string, string>;
  set: (key: string, value: string, opts: { NX: true; EX: number }) => Promise<"OK" | null>;
  getDel: (key: string) => Promise<string | null>;
  __reset: () => void;
};

let redisStub: RedisStub | null = null;
function makeRedisStub(): RedisStub {
  const storage = new Map<string, string>();
  return {
    storage,
    set: async (key, value, opts) => {
      if (opts.NX && storage.has(key)) return null;
      storage.set(key, value);
      // EX TTL is irrelevant for the unit tests — the consumer never
      // sleeps long enough for it to matter.
      return "OK";
    },
    getDel: async (key) => {
      const v = storage.get(key) ?? null;
      storage.delete(key);
      return v;
    },
    __reset: () => storage.clear(),
  };
}

vi.mock("../redis-client", () => ({
  getRedisClient: () => redisStub,
  initRedisClient: async () => redisStub,
  requireRedisClient: () => redisStub,
  isRedisInitialised: () => redisStub !== null,
  stopPingWatchdog: () => {},
}));

// Import AFTER the mock is registered so the module's top-level import
// of getRedisClient resolves to the stub.
const consent = await import("../account-link-consent");

beforeEach(() => {
  redisStub = makeRedisStub();
});

afterEach(() => {
  redisStub = null;
});

describe("account-link-consent — issue / consume", () => {
  it("issues a 64-character hex token (256 bits)", async () => {
    const token = await consent.issueConsentToken({
      candidateUserId: 7,
      firebaseUid: "uid-fake",
    });
    // 32 bytes encoded as hex = 64 characters.
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("two adjacent issues produce different tokens", async () => {
    const a = await consent.issueConsentToken({ candidateUserId: 1, firebaseUid: "uid-a" });
    const b = await consent.issueConsentToken({ candidateUserId: 1, firebaseUid: "uid-a" });
    expect(a).not.toBe(b);
  });

  it("consume succeeds when candidate + uid match issuance", async () => {
    const token = await consent.issueConsentToken({
      candidateUserId: 7,
      firebaseUid: "uid-fake",
    });
    await expect(
      consent.consumeConsentToken(token, { candidateUserId: 7, firebaseUid: "uid-fake" }),
    ).resolves.toBeUndefined();
  });

  it("second consume of the same token returns EXPIRED (one-shot)", async () => {
    const token = await consent.issueConsentToken({
      candidateUserId: 7,
      firebaseUid: "uid-fake",
    });
    await consent.consumeConsentToken(token, { candidateUserId: 7, firebaseUid: "uid-fake" });
    await expect(
      consent.consumeConsentToken(token, { candidateUserId: 7, firebaseUid: "uid-fake" }),
    ).rejects.toMatchObject({ code: "EXPIRED" });
  });

  it("consume rejects with CANDIDATE_MISMATCH when candidate id differs", async () => {
    const token = await consent.issueConsentToken({
      candidateUserId: 7,
      firebaseUid: "uid-fake",
    });
    await expect(
      consent.consumeConsentToken(token, { candidateUserId: 8, firebaseUid: "uid-fake" }),
    ).rejects.toMatchObject({ code: "CANDIDATE_MISMATCH" });
    // The token MUST be deleted on first call regardless of validation
    // outcome — defense against an attacker retrying with corrected
    // fields. A second call returns EXPIRED.
    await expect(
      consent.consumeConsentToken(token, { candidateUserId: 7, firebaseUid: "uid-fake" }),
    ).rejects.toMatchObject({ code: "EXPIRED" });
  });

  it("consume rejects with FIREBASE_UID_MISMATCH when uid differs", async () => {
    const token = await consent.issueConsentToken({
      candidateUserId: 7,
      firebaseUid: "uid-fake",
    });
    await expect(
      consent.consumeConsentToken(token, {
        candidateUserId: 7,
        firebaseUid: "different-uid",
      }),
    ).rejects.toMatchObject({ code: "FIREBASE_UID_MISMATCH" });
  });

  it("consume rejects with INVALID_TOKEN on malformed input", async () => {
    await expect(
      consent.consumeConsentToken("", { candidateUserId: 7, firebaseUid: "uid-fake" }),
    ).rejects.toMatchObject({ code: "INVALID_TOKEN" });
    await expect(
      consent.consumeConsentToken("too-short", {
        candidateUserId: 7,
        firebaseUid: "uid-fake",
      }),
    ).rejects.toMatchObject({ code: "INVALID_TOKEN" });
  });

  it("issue throws REDIS_UNAVAILABLE when Redis is null", async () => {
    redisStub = null;
    await expect(
      consent.issueConsentToken({ candidateUserId: 7, firebaseUid: "uid-fake" }),
    ).rejects.toMatchObject({ code: "REDIS_UNAVAILABLE" });
  });

  it("does NOT store the raw firebase UID in Redis (only its sha256 hash)", async () => {
    const uid = "very-recognisable-uid-do-not-leak";
    const token = await consent.issueConsentToken({ candidateUserId: 7, firebaseUid: uid });
    const stored = redisStub!.storage.get(`account-link-consent:${token}`)!;
    expect(stored).not.toContain(uid);
    // The hash IS present (verifies the schema).
    expect(stored).toMatch(/[0-9a-f]{64}/);
  });
});

describe("account-link-consent — masking helpers", () => {
  it("masks an email to first-letter + 4 dots + domain", () => {
    expect(consent.maskEmail("john.doe@example.com")).toBe("j••••@example.com");
    expect(consent.maskEmail("a@b.co")).toBe("a••••@b.co");
  });

  it("hides the local-part length (always 4 dots regardless of input)", () => {
    // Long local part — still 4 dots, not 8.
    expect(consent.maskEmail("a-very-long-username@example.com")).toBe("a••••@example.com");
  });

  it("returns null for malformed / missing email", () => {
    expect(consent.maskEmail(null)).toBeNull();
    expect(consent.maskEmail(undefined)).toBeNull();
    expect(consent.maskEmail("")).toBeNull();
    expect(consent.maskEmail("no-at-sign")).toBeNull();
    expect(consent.maskEmail("@no-local")).toBeNull();
    expect(consent.maskEmail("no-domain@")).toBeNull();
  });

  it("masks a Libyan phone — head + tail visible, middle hidden", () => {
    // 9-digit Libyan local format: head 1 + 6 dots + tail 2.
    expect(consent.maskPhone("912345678")).toBe("9••••••78");
  });

  it("returns null for too-short phones", () => {
    expect(consent.maskPhone(null)).toBeNull();
    expect(consent.maskPhone("")).toBeNull();
    expect(consent.maskPhone("12")).toBeNull();
  });
});
