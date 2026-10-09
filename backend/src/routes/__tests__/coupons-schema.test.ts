import { describe, expect, it } from "vitest";
import { CreateCouponBody } from "../coupons";

/**
 * Round-3 regression tests (audit M2): the coupon admin create/patch
 * schemas. Before the fix, an object-valued min_order_amount reached
 * Postgres as "[object Object]" (500), an invalid expires_at produced
 * Invalid Date (500), a non-string description crashed .trim() (500),
 * and a fixed-type value had NO upper bound (direct wallet-debit
 * magnitude at checkout).
 *
 * R124 (A9-F1): the route schema is now EXPORTED (generated
 * @workspace/api-zod contract base + the M2 extension), so these tests
 * pin the REAL composed schema. The old re-declared mirror that could
 * silently drift from the route is gone.
 */

describe("CreateCouponBody schema (coupon-admin money perimeter)", () => {
  it("accepts a sane fixed coupon", () => {
    const parsed = CreateCouponBody.safeParse({
      code: "welcome10",
      type: "fixed",
      value: 10,
      min_order_amount: 50,
      max_uses: 100,
      expires_at: "2026-12-31T23:59:59Z",
      description: "  عيد ميلاد سعيد  ",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an object-valued min_order_amount (the '[object Object]' → 500 path)", () => {
    const parsed = CreateCouponBody.safeParse({
      code: "x",
      type: "fixed",
      value: 10,
      min_order_amount: { evil: "object" },
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a non-ISO / unparseable expires_at (the Invalid-Date → 500 path)", () => {
    expect(
      CreateCouponBody.safeParse({ code: "x", type: "fixed", value: 5, expires_at: "ليلة أمس" })
        .success,
    ).toBe(false);
    expect(
      CreateCouponBody.safeParse({ code: "x", type: "fixed", value: 5, expires_at: "2026-13-45" })
        .success,
    ).toBe(false);
  });

  it("rejects a non-string description (the .trim() TypeError → 500 path)", () => {
    const parsed = CreateCouponBody.safeParse({
      code: "x",
      type: "fixed",
      value: 5,
      description: 12345,
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects an over-cap fixed value (the unbounded wallet-debit magnitude)", () => {
    const parsed = CreateCouponBody.safeParse({
      code: "x",
      type: "fixed",
      value: 999_999,
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects non-finite values (Infinity/NaN from JSON edge payloads)", () => {
    expect(
      CreateCouponBody.safeParse({ code: "x", type: "fixed", value: Number.POSITIVE_INFINITY })
        .success,
    ).toBe(false);
    expect(
      CreateCouponBody.safeParse({ code: "x", type: "fixed", value: Number.NaN }).success,
    ).toBe(false);
  });

  it("rejects non-integer or negative max_uses (dead-coupon class)", () => {
    expect(
      CreateCouponBody.safeParse({ code: "x", type: "fixed", value: 5, max_uses: 2.5 }).success,
    ).toBe(false);
    expect(
      CreateCouponBody.safeParse({ code: "x", type: "fixed", value: 5, max_uses: -1 }).success,
    ).toBe(false);
  });
});
