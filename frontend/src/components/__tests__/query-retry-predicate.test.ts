/**
 * 98-F7 (r97 F-13) — QueryClient retry predicate tests.
 *
 * The app-wide default was `retry: 1`: EVERY failure got one blind
 * retry — including 4xx responses, which are contract verdicts
 * (404 expired product, 400 validation, 401 expired session) that can
 * never succeed on an identical re-send, and 401s where the admin
 * session handler already toasts + redirects (the retry only doubled
 * the failure latency). Now only network failures (TypeError) and
 * HTTP 5xx retry, max once.
 *
 * isRetryableQueryError is exported from App.tsx for exactly this
 * regression test (DeferredSocketInitializer precedent).
 */

import { describe, expect, it } from "vitest";
import { isRetryableQueryError } from "@/App";

/** ApiError stand-in — the shared package type-exports the class, so
 *  the predicate duck-types the `status` field (see its docstring). */
function httpError(status: number): Error & { status: number } {
  const e = new Error(`HTTP ${status}`) as Error & { status: number };
  e.status = status;
  return e;
}

describe("isRetryableQueryError — only network + 5xx retry (r97 F-13)", () => {
  it("retries network-level TypeErrors (offline/DNS/customFetch timeout shape)", () => {
    expect(isRetryableQueryError(new TypeError("Failed to fetch"))).toBe(true);
    // customFetch's timeout mapping preserves the browser's exact
    // network-error message — same class.
    expect(isRetryableQueryError(new TypeError("Load failed"))).toBe(true);
  });

  it.each([500, 502, 503, 504])("retries HTTP %i (transient server-side)", (status) => {
    expect(isRetryableQueryError(httpError(status))).toBe(true);
  });

  it.each([400, 401, 403, 404, 409, 422, 429])(
    "does NOT retry HTTP %i (client-side verdict — re-sending cannot succeed)",
    (status) => {
      expect(isRetryableQueryError(httpError(status))).toBe(false);
    },
  );

  it("does not retry plain thrown Errors (hand-rolled queryFn failures own their surfacing)", () => {
    expect(isRetryableQueryError(new Error("boom"))).toBe(false);
  });

  it("is safe on non-error inputs (null/undefined/objects without status)", () => {
    expect(isRetryableQueryError(null)).toBe(false);
    expect(isRetryableQueryError(undefined)).toBe(false);
    expect(isRetryableQueryError({ status: "503" })).toBe(false);
    expect(isRetryableQueryError({})).toBe(false);
  });
});
