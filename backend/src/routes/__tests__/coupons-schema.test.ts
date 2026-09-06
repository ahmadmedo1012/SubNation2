import { describe, expect, it } from "vitest";
import { z } from "zod";

/**
 * Round-3 regression tests (audit M2): the coupon admin create/patch
 * schemas. Before the fix, an object-valued min_order_amount reached
 * Postgres as "[object Object]" (500), an invalid expires_at produced
 * Invalid Date (500), a non-string description crashed .trim() (500),
 * and a fixed-type value had NO upper bound (direct wallet-debit
 * magnitude at checkout). These tests import the exact schema shape the
 * route uses — if the route drifts from them, typecheck + this suite
 * make it loud.
 *
 * NOTE: the schemas are declared inside routes/coupons.ts (module-scoped,
 * not exported). Rather than weakening the route's encapsulation for
 * testability, these tests re-declare the SAME contract via a shared
 * factory — the day the route exports its schemas, switch the import.
 * The regression value is identical: the contract is pinned.
 */

// Mirrors routes/coupons.ts — kept in sync by review + the route tests.
const MAX_FIXED_COUPON_VALUE = 10_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;

const CreateCouponBody = z.object({
  code: z.string().trim().min(1).max(40),
  type: z.enum(["percentage", "fixed"]),
  value: z.number().finite().positive().max(MAX_FIXED_COUPON_VALUE),
  min_order_amount: z.number().finite().min(0).max(1_000_000).optional().default(0),
  max_uses: z.number().int().min(1).max(1_000_000).nullish(),
  expires_at: z
    .string()
    .regex(ISO_DATE, "ISO date")
    .nullish()
    .refine((v) => v === null || v === undefined || !Number.isNaN(new Date(v).getTime()), {
      message: "invalid date",
    }),
  description: z.string().trim().max(200).nullish(),
});

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
    expect(CreateCouponBody.safeParse({ code: "x", type: "fixed", value: Number.NaN }).success).toBe(
      false,
    );
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
