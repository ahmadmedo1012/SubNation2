/**
 * 2026-09-20 (free-infrastructure round) — customFetch cold-start aware
 * retry against the backend's early-bind boot gate.
 *
 * Render Free is allowed to sleep now (all keep-alive removed). While
 * the backend boots, the gate middleware answers:
 *
 *     /api/healthz* → 503 {"status":"starting"}
 *     /api/*        → 503 {"error":"الخدمة قيد التشغيل، أعد المحاولة بعد لحظات"}
 *
 * The shared client transparently retries those (gate responses prove
 * the request was never routed — retries are side-effect-free), with a
 * dedicated 45 s budget once the marker is seen.
 *
 * Pinned here against the REAL shared client (no vi.mock of
 * @workspace/api-client-react) with a stubbed global fetch, fake
 * timers, and the controllable AbortSignal.timeout stand-in from
 * custom-fetch-network.test.ts:
 *
 *   1. gate 503 (Arabic marker) → retried until a 200 arrives;
 *      the caller sees the SUCCESS, not the intermediate 503;
 *   2. gate 503 (healthz "starting" marker) → same transparent retry;
 *   3. business 503 (different body) → NEVER retried, ApiError thrown
 *      immediately (one fetch call only);
 *   4. a gate that outlasts the dedicated budget → the LAST gate
 *      response is re-thrown as an honest 503 ApiError (no bare
 *      TypeError, no infinite polling);
 *   5. 401 + other statuses keep their existing single-shot behavior.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { customFetch } from "@workspace/api-client-react";

// ── AbortSignal.timeout stand-in (fake-timer driven) ────────────────────────

type Statics = {
  timeout?: (ms: number) => AbortSignal;
  any?: (signals: AbortSignal[]) => AbortSignal;
};

let savedTimeout: Statics["timeout"];
let savedAny: Statics["any"];

function installTimeoutStub() {
  Object.defineProperty(AbortSignal, "timeout", {
    configurable: true,
    writable: true,
    value: (ms: number) => {
      const controller = new AbortController();
      const fire = () =>
        controller.abort(
          typeof DOMException === "function"
            ? new DOMException("signal timed out", "TimeoutError")
            : Object.assign(new Error("signal timed out"), { name: "TimeoutError" }),
        );
      setTimeout(fire, ms);
      return controller.signal;
    },
  });
}

function restoreAbortStatics() {
  if (savedTimeout !== undefined) {
    Object.defineProperty(AbortSignal, "timeout", {
      configurable: true,
      writable: true,
      value: savedTimeout,
    });
  } else {
    delete (AbortSignal as Statics).timeout;
  }
  if (savedAny !== undefined) {
    Object.defineProperty(AbortSignal, "any", {
      configurable: true,
      writable: true,
      value: savedAny,
    });
  } else {
    delete (AbortSignal as Statics).any;
  }
}

// ── Fetch stubs ─────────────────────────────────────────────────────────────

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: (init.status ?? 200) >= 200 && (init.status ?? 200) < 300,
    status: init.status ?? 200,
    statusText: init.statusText ?? "OK",
    url: "",
    headers: new Headers({ "content-type": "application/json", ...(init.headers ?? {}) }),
    text: async () => text,
    json: async () => JSON.parse(text),
    blob: async () => new Blob(),
  } as unknown as Response;
}

const GATE_ARABIC = {
  error: "الخدمة قيد التشغيل، أعد المحاولة بعد لحظات",
  code: "SERVICE_UNAVAILABLE",
};
const GATE_STARTING = { status: "starting" };
const BUSINESS_503 = {
  error: "بيانات هذا المنتج تحتاج صيانة من الإدارة حالياً",
  code: "SERVICE_UNAVAILABLE",
};

beforeEach(() => {
  savedTimeout = (AbortSignal as Statics).timeout;
  savedAny = (AbortSignal as Statics).any;
  installTimeoutStub();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  restoreAbortStatics();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("customFetch — cold-start boot-gate retry (2026-09-20)", () => {
  it("retries a gated 503 (Arabic marker) until success — caller sees the 200", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(GATE_ARABIC, { status: 503 }))
      .mockResolvedValueOnce(jsonResponse(GATE_ARABIC, { status: 503 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: [1, 2, 3] }));
    vi.stubGlobal("fetch", fetchMock);

    const pending = customFetch<{ data: number[] }>("/api/products");
    // Drive the 1.5 s first backoff, then the 3 s second backoff.
    await vi.advanceTimersByTimeAsync(1_600);
    await vi.advanceTimersByTimeAsync(3_100);

    const result = await pending;
    expect(result).toEqual({ ok: true, data: [1, 2, 3] });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("retries the healthz {status:'starting'} marker the same way", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(GATE_STARTING, { status: 503 }))
      .mockResolvedValueOnce(jsonResponse({ status: "ok" }));
    vi.stubGlobal("fetch", fetchMock);

    const pending = customFetch<{ status: string }>("/api/healthz");
    await vi.advanceTimersByTimeAsync(1_600);
    const result = await pending;
    expect(result).toEqual({ status: "ok" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("a business 503 is NEVER retried — one fetch, immediate ApiError", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(BUSINESS_503, { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    const pending = customFetch("/api/orders").catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(10_000);
    const err = await pending;

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((err as { status?: number }).status).toBe(503);
    expect((err as { name?: string }).name).toBe("ApiError");
    // The honest business message, not the gate marker path.
    expect((err as Error).message).toContain("صيانة");
  });

  it("a gate that outlasts the dedicated budget → the last gate response is thrown (no infinite retry)", async () => {
    // Every fetch answers the gate — the boot never completes.
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(GATE_ARABIC, { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    const pending = customFetch("/api/products").catch((err: unknown) => err);
    // Roll the fake clock past the 45 s dedicated gate budget. Each
    // retry is gated by the loop-top deadline check, so the promise
    // settles with the stored gateResponseRef (a real 503 ApiError).
    await vi.advanceTimersByTimeAsync(60_000);
    const err = await pending;

    expect((err as { status?: number }).status).toBe(503);
    expect((err as { name?: string }).name).toBe("ApiError");
    expect((err as Error).message).toContain("قيد التشغيل");
    // Bounded: escalating 1.5/3 s then steady 5 s for ~45 s ≈ 9 retries.
    expect(fetchMock.mock.calls.length).toBeGreaterThan(3);
    expect(fetchMock.mock.calls.length).toBeLessThan(15);
  });

  it("401 keeps single-shot behavior (no retry) even though it is not 200", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: "unauthorized" }, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    const pending = customFetch("/api/auth/me").catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(8_000);
    const err = await pending;

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((err as { status?: number }).status).toBe(401);
  });
});
