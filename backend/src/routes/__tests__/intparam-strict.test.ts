import { describe, expect, it } from "vitest";
import type { Request } from "express";
import { intParam } from "../../lib/http";

/**
 * A5-14 (round-94): intParam used `Number.parseInt(value, 10)` and only
 * rejected NaN — "-5" (negative PK → wasted DB round trip → 404 with
 * the wrong shape) and "12abc" (silent truncation) passed. The OpenAPI
 * contract documents 400 «Invalid (non-integer) id» for :id params.
 * The parse is now digit-exact: positive integer, canonical string form.
 */

function reqWith(params: Record<string, string>): Request {
  return { params } as unknown as Request;
}

describe("intParam — strict digit-exact parse (A5-14)", () => {
  it("accepts plain positive integers", () => {
    expect(intParam(reqWith({ id: "42" }), "id")).toBe(42);
    expect(intParam(reqWith({ id: "1" }), "id")).toBe(1);
  });

  it("rejects negative ids (the documented 400 shape, not a 404)", () => {
    expect(intParam(reqWith({ id: "-5" }), "id")).toBeNull();
  });

  it("rejects garbage-suffixed values (no silent truncation)", () => {
    expect(intParam(reqWith({ id: "12abc" }), "id")).toBeNull();
    expect(intParam(reqWith({ id: "abc" }), "id")).toBeNull();
  });

  it("rejects zero and non-canonical numeric spellings", () => {
    expect(intParam(reqWith({ id: "0" }), "id")).toBeNull();
    expect(intParam(reqWith({ id: "012" }), "id")).toBeNull();
    expect(intParam(reqWith({ id: "+5" }), "id")).toBeNull();
    expect(intParam(reqWith({ id: "5.5" }), "id")).toBeNull();
    expect(intParam(reqWith({ id: "" }), "id")).toBeNull();
  });

  it("tolerates surrounding whitespace like parseInt did", () => {
    expect(intParam(reqWith({ id: " 12 " }), "id")).toBe(12);
  });
});
