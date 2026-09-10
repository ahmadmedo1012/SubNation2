/**
 * 96-F7 (R96 A6 #14) — getErrorMessage technical-leak guard tests.
 *
 * The fallthrough paths of getErrorMessage used to pass ANY string to
 * the user verbatim: a raw `error` string from a middleware layer
 * ("Forbidden"), customFetch's "HTTP 404 Not Found" prefix (the old
 * regex only caught 5xx), or an English Error message all landed
 * verbatim inside Arabic toasts.
 *
 * The guard (round-96):
 *
 *   1. Every `HTTP \d{3}`-prefixed message is recognized (4xx included).
 *      customFetch's "HTTP <status> <statusText>: <server message>"
 *      shape is stripped of the technical prefix; the server suffix
 *      survives ONLY when it carries Arabic script. A bare
 *      "HTTP 404 Not Found" collapses to the generic Arabic message.
 *   2. Envelope strings (`error` / `data.error` / `response.data.error`)
 *      pass through only when they visibly carry Arabic script — this
 *      app's backend authors every message in Arabic, so non-Arabic
 *      there means a middleware/proxy string by construction.
 *   3. Known network-failure shapes ("Failed to fetch"…) keep their
 *      Arabic wording (round-3 behavior pinned).
 *   4. The `code` mapping (round-3/93) is untouched — first branch,
 *      unchanged semantics.
 */

import { describe, expect, it } from "vitest";
import { getErrorMessage, ErrorCode } from "../errors";

const GENERIC_AR = "تعذّر الاتصال بالخدمة. تحقق من اتصالك وحاول مرة أخرى.";

describe("getErrorMessage — HTTP-prefixed technical messages (96-F7 A6 #14)", () => {
  it("a bare 4xx prefix falls back to Arabic — never verbatim English", () => {
    // customFetch's ApiError.message for a body-less 404.
    const out = getErrorMessage(new Error("HTTP 404 Not Found"));
    expect(out).toBe(GENERIC_AR);
    expect(out).not.toContain("HTTP");
    expect(out).not.toContain("Not Found");
  });

  it("5xx prefixes keep the round-3 Arabic fallback", () => {
    expect(getErrorMessage(new Error("HTTP 502 Bad Gateway"))).toBe(GENERIC_AR);
    expect(getErrorMessage(new Error("HTTP 500 Internal Server Error"))).toBe(GENERIC_AR);
  });

  it("strips the technical prefix and KEEPS an Arabic server suffix", () => {
    // customFetch builds "HTTP <status> <statusText>: <message>" when
    // the body carries a message/error field but no code was mapped.
    const out = getErrorMessage(new Error("HTTP 400 Bad Request: البيانات غير صالحة"));
    expect(out).toBe("البيانات غير صالحة");
    expect(out).not.toContain("HTTP");
  });

  it("an English suffix behind an HTTP prefix still collapses to Arabic", () => {
    const out = getErrorMessage(new Error("HTTP 403 Forbidden: access denied"));
    expect(out).toBe(GENERIC_AR);
  });
});

describe("getErrorMessage — envelope strings pass through only in Arabic (96-F7 A6 #14)", () => {
  it("an Arabic err.error surfaces verbatim (backward compatibility)", () => {
    // The topups 409 DUPLICATE_PAYMENT_REFERENCE body shape.
    expect(getErrorMessage({ error: "مرجع دفع مكرر: يوجد طلب شحن معتمد مطابق" })).toBe(
      "مرجع دفع مكرر: يوجد طلب شحن معتمد مطابق",
    );
  });

  it("an English err.error (middleware layer) falls back to Arabic", () => {
    const out = getErrorMessage({ error: "Forbidden" });
    expect(out).toBe(GENERIC_AR);
    expect(out).not.toContain("Forbidden");
  });

  it("an Arabic data.error surfaces verbatim (ApiError envelope, SIM P1 pin)", () => {
    const out = getErrorMessage({
      name: "ApiError",
      status: 409,
      message: "HTTP 409 Conflict: مرجع دفع مكرر",
      data: { error: "مرجع دفع مكرر: يوجد طلب شحن معتمد مطابق (الطلبات: 21)" },
    });
    expect(out).toBe("مرجع دفع مكرر: يوجد طلب شحن معتمد مطابق (الطلبات: 21)");
  });

  it("an English data.error falls back to Arabic", () => {
    expect(getErrorMessage({ data: { error: "internal" } })).toBe(GENERIC_AR);
  });
});

describe("getErrorMessage — network-failure shapes keep the round-3 wording", () => {
  it("browser network TypeErrors speak Arabic", () => {
    expect(getErrorMessage(new TypeError("Failed to fetch"))).toBe(GENERIC_AR);
    expect(getErrorMessage(new Error("Load failed"))).toBe(GENERIC_AR);
    expect(getErrorMessage(new Error("NetworkError when attempting to fetch resource."))).toBe(
      GENERIC_AR,
    );
  });

  it("an Arabic Error.message surfaces verbatim (known server wording)", () => {
    expect(getErrorMessage(new Error("خطأ في الخادم"))).toBe("خطأ في الخادم");
  });

  it("an English Error.message with no HTTP prefix falls back to Arabic", () => {
    expect(getErrorMessage(new Error("Unexpected token < in JSON"))).toBe(GENERIC_AR);
  });
});

describe("getErrorMessage — code mapping and shape guards (regression pins)", () => {
  it("mapped codes still resolve to their Arabic message first", () => {
    expect(getErrorMessage({ code: ErrorCode.INVALID_OTP })).toBe(
      "رمز التحقق غير صحيح أو منتهي الصلاحية",
    );
    expect(getErrorMessage({ data: { code: "INSUFFICIENT_BALANCE" } })).toBe(
      "رصيد المحفظة غير كافٍ. يرجى شحن المحفظة أولاً",
    );
  });

  it("non-object input returns the generic Arabic fallback", () => {
    expect(getErrorMessage(null)).toBe("حدث خطأ. حاول مرة أخرى");
    expect(getErrorMessage(undefined)).toBe("حدث خطأ. حاول مرة أخرى");
    expect(getErrorMessage("some string")).toBe("حدث خطأ. حاول مرة أخرى");
  });

  it("an empty object falls through to the generic Arabic fallback", () => {
    expect(getErrorMessage({})).toBe("حدث خطأ. حاول مرة أخرى");
  });
});
