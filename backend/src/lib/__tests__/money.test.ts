import { describe, expect, it } from "vitest";
import { roundLyd, roundLydString } from "../money";

/**
 * R118-A5 TOP-20 #20 [P3] — lib/money.ts direct contract.
 *
 * roundLyd is the LYD rounding insert boundary for wallet.ts /
 * topup.service.ts; until now it was only exercised incidentally through
 * routes/__tests__/wallet-topups.test.ts:774 (10.555 → credited 10.56).
 * This suite pins the boundary matrix from the module's own doc header:
 *
 *   10.555  → 10.56  (the binary-dust case: the stored double is
 *                    10.55499999…, plain toFixed(2) would yield 10.55)
 *   10.5551 → 10.56  (true half-up)
 *   10.5549 → 10.55
 *   10.4999 → 10.50
 *
 * NEGATIVE halves: Math.round rounds halves toward +Infinity, so the
 * documented "half-up" reads −10.555 → −10.55 (NOT −10.56 — that would
 * be half-away-from-zero). This suite pins the module's ACTUAL
 * semantics; the A5 sketch's "−10.555→−10.56" line described
 * away-from-zero and is corrected here.
 *
 * Non-finite inputs pass through unchanged (module contract: the caller
 * — e.g. lib/numeric toNumber — owns the corruption guard; roundLyd
 * never invents a value).
 */

describe("roundLyd — boundary matrix (R118-A5 #20)", () => {
  it("the documented binary-dust / half-up cases", () => {
    expect(roundLyd(10.555)).toBe(10.56);
    expect(roundLyd(10.5551)).toBe(10.56);
    expect(roundLyd(10.5549)).toBe(10.55);
    expect(roundLyd(10.4999)).toBe(10.5);
  });

  it("plain 2-decimal values round-trip unchanged (no epsilon drift)", () => {
    expect(roundLyd(10.56)).toBe(10.56);
    expect(roundLyd(0)).toBe(0);
    expect(roundLyd(100)).toBe(100);
    expect(roundLyd(79.8)).toBe(79.8);
  });

  it("negative halves round toward +Infinity (Math.round semantics): −10.555 → −10.55, −10.5551 → −10.56", () => {
    // Half-up (toward +∞), NOT half-away-from-zero — see the docblock.
    expect(roundLyd(-10.555)).toBe(-10.55);
    expect(roundLyd(-10.5551)).toBe(-10.56);
    expect(roundLyd(-10.5549)).toBe(-10.55);
  });

  it("sub-cent dust and classic toFixed traps (0.005 / 0.125 / 1.005 / 2.675)", () => {
    expect(roundLyd(0.005)).toBe(0.01);
    expect(roundLyd(0.125)).toBe(0.13);
    expect(roundLyd(1.005)).toBe(1.01);
    expect(roundLyd(2.675)).toBe(2.68);
    expect(roundLyd(1e-12)).toBe(0);
  });

  it("±Infinity / NaN pass through unchanged (the corruption guard is the caller's job)", () => {
    expect(roundLyd(Infinity)).toBe(Infinity);
    expect(roundLyd(-Infinity)).toBe(-Infinity);
    expect(Number.isNaN(roundLyd(NaN))).toBe(true);
  });
});

describe("roundLydString — numeric(10,2)-ready insert boundary (R118-A5 #20)", () => {
  it("returns a plain 2-decimal string for the half-cent boundary", () => {
    expect(roundLydString(10.555)).toBe("10.56");
    expect(roundLydString(10.5549)).toBe("10.55");
    expect(roundLydString(0.125)).toBe("0.13");
  });

  it("stringifies every output like String(number) (insert-ready, no fixed-format padding)", () => {
    // The module contract is String(roundLyd(x)) — integers stay
    // unpadded ("10.5", not "10.50"); the DB numeric(10,2) column owns
    // the display scale.
    expect(roundLydString(10.4999)).toBe("10.5");
    expect(roundLydString(0)).toBe("0");
    expect(roundLydString(-10.555)).toBe("-10.55");
    // -0 normalizes to "0" (never the "-0" JSON/SQL oddity).
    expect(roundLydString(-0.005)).toBe("0");
  });

  it("passes non-finite inputs through as their string forms (String(Infinity), not a number)", () => {
    expect(roundLydString(Infinity)).toBe("Infinity");
    expect(roundLydString(NaN)).toBe("NaN");
  });
});
