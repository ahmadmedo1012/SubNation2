import { describe, expect, it } from "vitest";
import type { Request } from "express";
import { limitParam, pageParam } from "../http";

/**
 * R122 (A3-P2-2): pageParam clamped the FLOOR only (page ≥ 1; garbage/0 →
 * 1) — `?page=100000000` sailed through and multiplied into an OFFSET of
 * ~2×10⁷ rows on every consumer route (orders, wallet topups/ledger,
 * loyalty ledger/referrals). Deep paging is now clamped at MAX_PAGE
 * (10 000) — the garbage-in-clamped-out contract is unchanged, every
 * legitimate page value passes, and the abuse shape is bounded.
 */

function reqWithQuery(query: Record<string, unknown>): Request {
  return { query } as unknown as Request;
}

describe("pageParam — deep-pagination ceiling (R122 A3-P2-2)", () => {
  it("the pre-existing floor idiom is byte-identical: absent/garbage/0/negative → 1", () => {
    expect(pageParam(reqWithQuery({}))).toBe(1);
    expect(pageParam(reqWithQuery({ page: "abc" }))).toBe(1);
    expect(pageParam(reqWithQuery({ page: "0" }))).toBe(1);
    expect(pageParam(reqWithQuery({ page: "-3" }))).toBe(1);
    expect(pageParam(reqWithQuery({ page: "" }))).toBe(1);
  });

  it("legitimate page values pass through untouched (1 … 10 000)", () => {
    expect(pageParam(reqWithQuery({ page: "1" }))).toBe(1);
    expect(pageParam(reqWithQuery({ page: "2" }))).toBe(2);
    expect(pageParam(reqWithQuery({ page: "500" }))).toBe(500);
    expect(pageParam(reqWithQuery({ page: "9999" }))).toBe(9999);
    // The boundary itself is inclusive — 10 000 pages × the largest
    // per-route limit (200) = 2M offset max.
    expect(pageParam(reqWithQuery({ page: "10000" }))).toBe(10000);
  });

  it("pages beyond the ceiling clamp to 10 000 (was unbounded OFFSET)", () => {
    expect(pageParam(reqWithQuery({ page: "10001" }))).toBe(10000);
    expect(pageParam(reqWithQuery({ page: "999999" }))).toBe(10000);
    // The A3-P2-2 report's abuse shape: ?page=100000000&limit=200 used to
    // compute an OFFSET of ~2×10⁷ rows per request.
    expect(pageParam(reqWithQuery({ page: "100000000" }))).toBe(10000);
    // parseInt truncates scientific notation at "e" ("1e12" → 1) — the
    // floor idiom then keeps it at 1, never the ceiling.
    expect(pageParam(reqWithQuery({ page: "1e12" }))).toBe(1);
    // Numbers beyond Number.MAX_SAFE_INTEGER still parse as floats and clamp.
    expect(pageParam(reqWithQuery({ page: "99999999999999999999" }))).toBe(10000);
  });

  it("multi-value ?page= collapses to the first value (queryString idiom, unchanged)", () => {
    expect(pageParam(reqWithQuery({ page: ["3", "999999"] }))).toBe(3);
  });
});

describe("limitParam — unchanged sibling contract (regression guard for the same file)", () => {
  it("clamps to [1, max] with the NaN → default fallback", () => {
    expect(limitParam(reqWithQuery({}), 100, 200)).toBe(100);
    expect(limitParam(reqWithQuery({ limit: "50" }), 100, 200)).toBe(50);
    expect(limitParam(reqWithQuery({ limit: "500" }), 100, 200)).toBe(200);
    expect(limitParam(reqWithQuery({ limit: "0" }), 100, 200)).toBe(1);
    expect(limitParam(reqWithQuery({ limit: "abc" }), 100, 200)).toBe(100);
  });
});
