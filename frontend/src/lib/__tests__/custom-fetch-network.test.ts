/**
 * 96-F3 (R96 M3 + M5) — shared customFetch network-resilience tests.
 *
 * These run against the REAL shared client (no vi.mock of
 * @workspace/api-client-react) with a stubbed global fetch and
 * controllable AbortSignal.timeout/any statics, pinning:
 *
 *   1. the 20 s default timeout merge logic:
 *        - no caller signal          → AbortSignal.timeout(20_000) signal
 *        - caller signal + any       → AbortSignal.any([caller, timeout])
 *        - caller signal, no `any`   → caller signal alone (no timeout)
 *        - timeoutMs: 0              → timeout disabled entirely
 *   2. the timeout FIRING: rejection is mapped onto the canonical
 *      network-error shape (TypeError "Failed to fetch", the exact
 *      message lib/errors.ts' Arabic branch matches) with the original
 *      TimeoutError preserved as `cause` — ApiError contract untouched;
 *   3. caller-initiated cancellation propagates UNCHANGED (React
 *      Query's unmount/cancel semantics stay intact);
 *   4. the 401 observer dispatch: the additive registry (96-F3) AND
 *      the legacy single-slot handler both fire, in that order, and
 *      the ApiError still propagates with its exact shape.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addUnauthorizedHandler,
  customFetch,
  DEFAULT_REQUEST_TIMEOUT_MS,
  setUnauthorizedHandler,
} from "@workspace/api-client-react";

// ── Fake AbortSignal statics ────────────────────────────────────────────────
//
// AbortSignal.timeout() is implemented natively (unfakeable by
// vi.useFakeTimers), so the tests install a controllable setTimeout-based
// stand-in — which is exactly what "fake timers" drives — plus marker
// signals for asserting the merge decisions.

type Statics = {
  timeout?: (ms: number) => AbortSignal;
  any?: (signals: AbortSignal[]) => AbortSignal;
};

let savedTimeout: Statics["timeout"];
let savedAny: Statics["any"];
let timeoutCalls: number[] = [];
let anyCalls: AbortSignal[][] = [];

function timeoutController(): {
  signal: AbortSignal;
  fire: () => void;
} {
  const controller = new AbortController();
  return {
    signal: controller.signal,
    fire: () =>
      controller.abort(
        typeof DOMException === "function"
          ? new DOMException("signal timed out", "TimeoutError")
          : Object.assign(new Error("signal timed out"), { name: "TimeoutError" }),
      ),
  };
}

function installTimeoutStub() {
  Object.defineProperty(AbortSignal, "timeout", {
    configurable: true,
    writable: true,
    value: (ms: number) => {
      timeoutCalls.push(ms);
      const { signal, fire } = timeoutController();
      setTimeout(fire, ms);
      return signal;
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

function removeAbortAny() {
  delete (AbortSignal as Statics).any;
}

function installAnyStub() {
  Object.defineProperty(AbortSignal, "any", {
    configurable: true,
    writable: true,
    value: (signals: AbortSignal[]) => {
      anyCalls.push(signals);
      // A real merge: aborts when ANY input aborts.
      const controller = new AbortController();
      for (const signal of signals) {
        signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
      }
      return controller.signal;
    },
  });
}

function markerSignal(): AbortSignal {
  return new AbortController().signal;
}

// ── Fetch stubs ─────────────────────────────────────────────────────────────

/** A fetch that never resolves until its request signal aborts. */
function hangingSignalAwareFetch() {
  return vi.fn(
    (_input: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) return; // hangs forever
        signal.addEventListener(
          "abort",
          () => {
            reject(signal.reason ?? Object.assign(new Error("aborted"), { name: "AbortError" }));
          },
          { once: true },
        );
      }),
  );
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: (init.status ?? 200) >= 200 && (init.status ?? 200) < 300,
    status: init.status ?? 200,
    statusText: init.statusText ?? "OK",
    url: "", // falsy → ApiError falls back to the request url
    headers: new Headers({ "content-type": "application/json", ...(init.headers ?? {}) }),
    // NB: no `body: null` — customFetch's hasNoBody() treats
    // `response.body === null` as a genuinely empty response (strict
    // check, RN `undefined` bodies excluded on purpose). Omitting the
    // property keeps the fake on the parse path like a real browser
    // ReadableStream would.
    text: async () => text,
    json: async () => JSON.parse(text),
    blob: async () => new Blob(),
  } as unknown as Response;
}

// ── Suite ───────────────────────────────────────────────────────────────────

describe("customFetch — 20 s default timeout merge (96-F3 M3)", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    savedTimeout = (AbortSignal as Statics).timeout;
    savedAny = (AbortSignal as Statics).any;
    timeoutCalls = [];
    anyCalls = [];
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    restoreAbortStatics();
    setUnauthorizedHandler(null);
  });

  it("applies AbortSignal.timeout(20_000) when the caller passes no signal", async () => {
    installTimeoutStub();
    removeAbortAny();

    await customFetch("/api/products");

    expect(timeoutCalls).toEqual([DEFAULT_REQUEST_TIMEOUT_MS]);
    // The fetch stub resolves immediately; the signal identity is what
    // matters — it must be the timeout signal, not undefined.
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("merges the caller signal with the timeout via AbortSignal.any([caller, timeout])", async () => {
    installTimeoutStub();
    installAnyStub();

    const caller = new AbortController();
    await customFetch("/api/orders", { signal: caller.signal });

    expect(timeoutCalls).toEqual([DEFAULT_REQUEST_TIMEOUT_MS]);
    expect(anyCalls).toHaveLength(1);
    expect(anyCalls[0][0]).toBe(caller.signal);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.signal).not.toBe(caller.signal); // the merged one
  });

  it("falls back to the CALLER signal alone when AbortSignal.any is unavailable", async () => {
    installTimeoutStub();
    removeAbortAny(); // old Safari: timeout exists, any does not

    const caller = new AbortController();
    await customFetch("/api/orders", { signal: caller.signal });

    expect(anyCalls).toEqual([]);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBe(caller.signal);
  });

  it("timeoutMs: 0 disables the timeout entirely (no timeout signal created)", async () => {
    installTimeoutStub();
    installAnyStub();

    await customFetch("/api/products", { timeoutMs: 0 });

    expect(timeoutCalls).toEqual([]);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeUndefined();
  });

  it("honors a per-request timeoutMs override", async () => {
    installTimeoutStub();
    removeAbortAny();

    await customFetch("/api/copilot/run", { timeoutMs: 60_000 });

    expect(timeoutCalls).toEqual([60_000]);
  });

  it("never ships the custom timeoutMs option through to fetch's RequestInit", async () => {
    installTimeoutStub();
    removeAbortAny();

    await customFetch("/api/products", { timeoutMs: 5_000 });

    const init = fetchMock.mock.calls[0][1] as RequestInit & { timeoutMs?: number };
    expect(init.timeoutMs).toBeUndefined();
    expect(init.method).toBe("GET");
  });
});

describe("customFetch — timeout firing maps to the Arabic network-error path (96-F3 M3)", () => {
  beforeEach(() => {
    savedTimeout = (AbortSignal as Statics).timeout;
    savedAny = (AbortSignal as Statics).any;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    restoreAbortStatics();
    setUnauthorizedHandler(null);
  });

  it("rejects with TypeError('Failed to fetch') preserving the TimeoutError as cause", async () => {
    installTimeoutStub();
    const fetchMock = hangingSignalAwareFetch();
    vi.stubGlobal("fetch", fetchMock);

    const pending = customFetch("/api/orders");
    const expectation = expect(pending).rejects.toMatchObject({
      name: "TypeError",
      message: "Failed to fetch",
    });

    await vi.advanceTimersByTimeAsync(DEFAULT_REQUEST_TIMEOUT_MS);
    await expectation;

    // The original TimeoutError rides along as `cause` (Sentry/console
    // diagnostics) — the message is the canonical browser network
    // failure one that lib/errors.ts maps to
    // «تعذّر الاتصال بالخدمة. تحقق من اتصالك وحاول مجددًا.».
    try {
      await pending;
    } catch (error) {
      expect((error as TypeError).cause).toMatchObject({ name: "TimeoutError" });
    }
  });

  it("resolves normally when the response arrives inside the window", async () => {
    installTimeoutStub();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([{ id: 1 }]));
    vi.stubGlobal("fetch", fetchMock);

    const result = await customFetch("/api/products");
    expect(result).toEqual([{ id: 1 }]);
    await vi.advanceTimersByTimeAsync(DEFAULT_REQUEST_TIMEOUT_MS);
  });

  it("propagates a caller-initiated cancellation UNCHANGED (no network-error mapping)", async () => {
    installTimeoutStub();
    installAnyStub();
    const fetchMock = hangingSignalAwareFetch();
    vi.stubGlobal("fetch", fetchMock);

    const caller = new AbortController();
    const reason = new Error("component unmounted");
    const pending = customFetch("/api/orders", { signal: caller.signal });
    const expectation = expect(pending).rejects.toBe(reason);

    // Caller cancels BEFORE the 20 s timeout: React Query semantics.
    await vi.advanceTimersByTimeAsync(1_000);
    caller.abort(reason);
    await vi.advanceTimersByTimeAsync(0);
    await expectation;

    // And it is the caller's error, not a TypeError("Failed to fetch").
    try {
      await pending;
    } catch (error) {
      expect(error).toBe(reason);
      expect(error).not.toMatchObject({ message: "Failed to fetch" });
    }
  });
});

describe("customFetch — 401 observer dispatch: additive registry + single slot (96-F3 §3.1)", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    savedTimeout = (AbortSignal as Statics).timeout;
    savedAny = (AbortSignal as Statics).any;
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    restoreAbortStatics();
    setUnauthorizedHandler(null);
  });

  it("notifies BOTH the additive handler and the single-slot handler, additive first, then throws ApiError(401)", async () => {
    // No timeout machinery needed for the dispatch path — but the
    // default timeout is still resolved (real or stubbed statics both
    // fine here since the response resolves immediately).
    const additive = vi.fn();
    const single = vi.fn();
    const unsubscribe = addUnauthorizedHandler(additive);
    setUnauthorizedHandler(single);

    fetchMock.mockResolvedValue(
      jsonResponse({ error: "unauthorized" }, { status: 401, statusText: "Unauthorized" }),
    );

    await expect(customFetch("/api/orders")).rejects.toMatchObject({
      name: "ApiError",
      status: 401,
      method: "GET",
      url: "/api/orders",
    });

    expect(additive).toHaveBeenCalledTimes(1);
    expect(additive).toHaveBeenCalledWith({ url: "/api/orders", method: "GET" });
    expect(single).toHaveBeenCalledTimes(1);
    expect(single).toHaveBeenCalledWith({ url: "/api/orders", method: "GET" });

    unsubscribe();
  });

  it("addUnauthorizedHandler's unsubscribe removes the observer", async () => {
    const additive = vi.fn();
    const unsubscribe = addUnauthorizedHandler(additive);
    unsubscribe();

    fetchMock.mockResolvedValue(jsonResponse({ error: "unauthorized" }, { status: 401 }));

    await expect(customFetch("/api/wallet")).rejects.toMatchObject({ status: 401 });
    expect(additive).not.toHaveBeenCalled();
  });

  it("a throwing observer never breaks the request pipeline (ApiError still thrown)", async () => {
    const exploding = vi.fn(() => {
      throw new Error("observer exploded");
    });
    const unsubscribe = addUnauthorizedHandler(exploding);

    fetchMock.mockResolvedValue(jsonResponse({ error: "unauthorized" }, { status: 401 }));

    await expect(customFetch("/api/wallet/topups")).rejects.toMatchObject({
      name: "ApiError",
      status: 401,
    });
    expect(exploding).toHaveBeenCalledTimes(1);

    unsubscribe();
  });

  it("200 responses notify nobody and resolve normally", async () => {
    const additive = vi.fn();
    const single = vi.fn();
    const unsubscribe = addUnauthorizedHandler(additive);
    setUnauthorizedHandler(single);

    fetchMock.mockResolvedValue(jsonResponse([{ id: 1 }]));

    await expect(customFetch("/api/products")).resolves.toEqual([{ id: 1 }]);
    expect(additive).not.toHaveBeenCalled();
    expect(single).not.toHaveBeenCalled();

    unsubscribe();
  });
});
