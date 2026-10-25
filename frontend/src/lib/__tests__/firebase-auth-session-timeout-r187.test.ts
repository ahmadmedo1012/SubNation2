/**
 * R187 (C-F1) — the Firebase session-mint + refresh fetches carry the
 * 20 s budget (the last unbounded auth requests in the frontend).
 *
 * Every sibling mint gained a hard ceiling over R142–R144 (customFetch's
 * 20 s DEFAULT_REQUEST_TIMEOUT_MS, adminFetch's timeoutMs, the boot
 * probes' 10 s AbortSignal.timeout) — lib/firebase-auth.ts kept TWO raw
 * fetches with NO AbortSignal anywhere in the file, so a black-holed TCP
 * held the Google sign-in button spinning to the ~300 s OS timeout and
 * each stall burned an authLimiter slot (10/15 min).
 *
 * Pinned here (the custom-fetch-network.test.ts harness idioms):
 *   1. behavior: a never-resolving fetch + fake timers →
 *      exchangeFirebaseIdToken("x".repeat(200)) rejects WITHIN 20 s;
 *   2. behavior: the rejection funnels through getErrorMessage to the
 *      Arabic network copy (the caller AuthProviders' catch arm — a
 *      TimeoutError is technical English that must never land raw);
 *   3. behavior: a response arriving inside the window resolves
 *      normally (the signal changes nothing on the healthy path);
 *   4. source pin: BOTH raw fetches (session :86 + refresh :124) carry
 *      AbortSignal.timeout(20_000) — the refresh twin has no exported
 *      entry point, so its budget is pinned by the comment-stripped
 *      count (the raw-fetch-gate r144 style).
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getErrorMessage } from "@/lib/errors";
import { exchangeFirebaseIdToken } from "@/lib/firebase-auth";

// ── Fake AbortSignal statics (custom-fetch-network.test.ts idiom) ───────────
//
// AbortSignal.timeout() is implemented natively (unfakeable by
// vi.useFakeTimers), so a controllable setTimeout-based stand-in drives
// the 20 s budget off the fake clock.

type Statics = {
  timeout?: (ms: number) => AbortSignal;
};

let savedTimeout: Statics["timeout"];

function timeoutController(): { signal: AbortSignal; fire: () => void } {
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
}

/** A fetch that never resolves until its request signal aborts. */
function hangingSignalAwareFetch() {
  return vi.fn(
    (_input: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) return; // hangs forever (the pre-R187 shape)
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

describe("exchangeFirebaseIdToken — the 20 s session-mint budget (R187 C-F1)", () => {
  beforeEach(() => {
    savedTimeout = (AbortSignal as Statics).timeout;
    installTimeoutStub();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    restoreAbortStatics();
  });

  it("a never-resolving mint rejects WITHIN 20 s with the timeout shape", async () => {
    const fetchMock = hangingSignalAwareFetch();
    vi.stubGlobal("fetch", fetchMock);

    const pending = exchangeFirebaseIdToken("x".repeat(200));
    const expectation = expect(pending).rejects.toMatchObject({ name: "TimeoutError" });

    // The budget is 20 s — the request is still in flight at 19.999 s
    // (the old unbounded fetch NEVER settles: this advance is a no-op).
    await vi.advanceTimersByTimeAsync(19_999);
    // …and aborts on the next millisecond.
    await vi.advanceTimersByTimeAsync(1);
    await expectation;

    // The fetch carried a real signal (the raw-fetch shape otherwise
    // preserved: same URL, same credentials, same body path).
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("the abort funnels through getErrorMessage to the Arabic network copy (the AuthProviders catch arm)", async () => {
    const fetchMock = hangingSignalAwareFetch();
    vi.stubGlobal("fetch", fetchMock);

    const pending = exchangeFirebaseIdToken("x".repeat(200));
    const expectation = expect(pending).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(20_000);
    await expectation;

    let caught: unknown;
    try {
      await pending;
    } catch (err) {
      caught = err;
    }
    // The technical TimeoutError message collapses to the generic
    // Arabic network copy — never raw English in the error slot.
    expect(getErrorMessage(caught)).toBe("تعذّر الاتصال بالخدمة. تحقق من اتصالك وحاول مرة أخرى.");
  });

  it("a response arriving inside the window resolves normally (the healthy path is unchanged)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ token: "t", user: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const session = await exchangeFirebaseIdToken("x".repeat(200));
    expect(session.token).toBe("t");
  });
});

describe("source pin — BOTH raw fetches carry the budget (R187 C-F1)", () => {
  // The storefront-r128-sweep idiom: strip comments so a documented
  // `AbortSignal.timeout(20_000)` inside prose cannot fake an
  // occurrence (and a commented-out call must not count as live).
  function stripComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
  }

  it("firebase-auth.ts mints BOTH fetch signals with AbortSignal.timeout(20_000)", () => {
    const source = stripComments(
      readFileSync(resolve(process.cwd(), "src/lib/firebase-auth.ts"), "utf8"),
    );
    expect(source.match(/AbortSignal\.timeout\(20_000\)/g) ?? []).toHaveLength(2);
  });
});
