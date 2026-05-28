import { describe, expect, it } from "vitest";
import {
  compareOtpHash,
  generateOtp,
  hashOtp,
  OTP_LENGTH,
  OTP_MAX_ATTEMPTS,
  type OtpRow,
  verifyOtp,
} from "../whatsapp-otp";

const SECRET = "test-server-secret-for-otp-binding-not-real";
const PHONE = "913456789";
const PURPOSE = "registration" as const;

function freshRow(overrides: Partial<OtpRow> = {}): OtpRow {
  const code = "123456";
  return {
    codeHash: hashOtp(code, PHONE, PURPOSE, SECRET),
    phone: PHONE,
    purpose: PURPOSE,
    expiresAt: new Date(Date.now() + 60_000),
    attempts: 0,
    consumedAt: null,
    ...overrides,
  };
}

describe("generateOtp", () => {
  it("emits exactly OTP_LENGTH digits", () => {
    for (let i = 0; i < 50; i++) {
      const code = generateOtp();
      expect(code).toMatch(new RegExp(`^\\d{${OTP_LENGTH}}$`));
    }
  });

  it("does not collide trivially across 1000 samples", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(generateOtp());
    // 1k samples from a 1M keyspace — almost no collisions expected.
    expect(seen.size).toBeGreaterThan(990);
  });
});

describe("hashOtp", () => {
  it("binds to (code, phone, purpose, secret) — changing any field breaks the hash", () => {
    const base = hashOtp("123456", PHONE, PURPOSE, SECRET);
    expect(hashOtp("123457", PHONE, PURPOSE, SECRET)).not.toBe(base);
    expect(hashOtp("123456", "999999999", PURPOSE, SECRET)).not.toBe(base);
    expect(hashOtp("123456", PHONE, "login", SECRET)).not.toBe(base);
    expect(hashOtp("123456", PHONE, PURPOSE, "different-secret")).not.toBe(base);
  });

  it("requires a secret", () => {
    expect(() => hashOtp("123456", PHONE, PURPOSE, "")).toThrow();
  });
});

describe("compareOtpHash", () => {
  it("accepts identical hashes", () => {
    const h = hashOtp("123456", PHONE, PURPOSE, SECRET);
    expect(compareOtpHash(h, h)).toBe(true);
  });

  it("rejects different-length inputs without throwing", () => {
    expect(compareOtpHash("abc", "abcdef")).toBe(false);
  });

  it("rejects malformed hex without throwing", () => {
    const h = hashOtp("123456", PHONE, PURPOSE, SECRET);
    expect(compareOtpHash("zzz", h)).toBe(false);
  });
});

describe("verifyOtp", () => {
  it("accepts the correct code on a fresh, unconsumed row", () => {
    const result = verifyOtp("123456", freshRow(), SECRET);
    expect(result.ok).toBe(true);
  });

  it("rejects a consumed code", () => {
    const result = verifyOtp("123456", freshRow({ consumedAt: new Date() }), SECRET);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("consumed");
  });

  it("rejects an expired code", () => {
    const result = verifyOtp(
      "123456",
      freshRow({ expiresAt: new Date(Date.now() - 1) }),
      SECRET,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("expired");
  });

  it("rejects after the attempt cap is hit", () => {
    const result = verifyOtp(
      "123456",
      freshRow({ attempts: OTP_MAX_ATTEMPTS }),
      SECRET,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("exhausted");
  });

  it("rejects a wrong code", () => {
    const result = verifyOtp("000000", freshRow(), SECRET);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("mismatch");
  });

  it("rejects non-numeric input", () => {
    const result = verifyOtp("abcdef", freshRow(), SECRET);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("mismatch");
  });

  it("rejects a code of the wrong length", () => {
    const result = verifyOtp("12345", freshRow(), SECRET);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("mismatch");
  });

  it("uses the supplied secret — different secrets reject the same code", () => {
    const result = verifyOtp("123456", freshRow(), "different-secret");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("mismatch");
  });
});
