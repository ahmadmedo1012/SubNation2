/**
 * R120-B5 (A5-F18) — web-vitals session sampling tests.
 *
 * initWebVitals had no sampling: every boot subscribed all five CWV
 * observers + the visibility/pagehide listeners and beconed every
 * session. The new `sampleRate` option (default 1.0 — the pre-R120
 * behavior, byte-for-byte) flips ONE coin per session and skips the
 * whole pipeline when it lands out.
 *
 * Pins:
 *   1. Default (no option): every session collects — all five
 *      subscriptions + both flush listeners register.
 *   2. sampleRate 0: never collects — zero subscriptions, zero
 *      document/window listeners.
 *   3. Out-of-range rates clamp toward collection (a bogus rate must
 *      never silently disable telemetry): NaN → 1.0; 2 → 1.0.
 *   4. The coin is flipped ONCE per init (session-level), not per
 *      metric — a 50% rate with Math.random mocked constant either
 *      subscribes ALL five or NONE.
 *
 * The web-vitals package is mocked at the module boundary (its
 * PerformanceObserver plumbing is irrelevant to the sampling contract);
 * sessionStorage is cleared per test so each init is a fresh session.
 */

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { initWebVitals } from "@/lib/web-vitals";

const onCLS = vi.fn();
const onFCP = vi.fn();
const onINP = vi.fn();
const onLCP = vi.fn();
const onTTFB = vi.fn();

vi.mock("web-vitals", () => ({
  onCLS: (cb: unknown) => onCLS(cb),
  onFCP: (cb: unknown) => onFCP(cb),
  onINP: (cb: unknown) => onINP(cb),
  onLCP: (cb: unknown) => onLCP(cb),
  onTTFB: (cb: unknown) => onTTFB(cb),
}));

/** jsdom document/window listener spies (the flush pipeline). */
let docAddSpy: MockInstance<typeof document.addEventListener>;
let winAddSpy: MockInstance<typeof window.addEventListener>;

function allSubscriptions(): number {
  return (
    onLCP.mock.calls.length +
    onFCP.mock.calls.length +
    onINP.mock.calls.length +
    onCLS.mock.calls.length +
    onTTFB.mock.calls.length
  );
}

beforeEach(() => {
  onCLS.mockClear();
  onFCP.mockClear();
  onINP.mockClear();
  onLCP.mockClear();
  onTTFB.mockClear();
  sessionStorage.clear();
  docAddSpy = vi.spyOn(document, "addEventListener");
  winAddSpy = vi.spyOn(window, "addEventListener");
});

afterEach(() => {
  docAddSpy.mockRestore();
  winAddSpy.mockRestore();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("initWebVitals — session-level sampling (R120-B5, A5-F18)", () => {
  it("default sampleRate 1.0 collects EVERY session (the pre-R120 behavior)", () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.999999);
    initWebVitals();

    // All five metric subscriptions fired…
    expect(allSubscriptions()).toBe(5);
    // …and the flush listeners registered (visibilitychange + pagehide).
    expect(docAddSpy.mock.calls.some(([type]) => type === "visibilitychange")).toBe(true);
    expect(winAddSpy.mock.calls.some(([type]) => type === "pagehide")).toBe(true);
    expect(randomSpy).toHaveBeenCalledTimes(1); // exactly one coin flip
  });

  it("sampleRate 0 collects nothing — no subscriptions, no flush listeners", () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    initWebVitals({ sampleRate: 0 });

    // Math.random() (0) >= rate (0) → out of sample: the whole pipeline
    // (subscriptions AND listeners) is skipped.
    expect(allSubscriptions()).toBe(0);
    expect(docAddSpy).not.toHaveBeenCalled();
    expect(winAddSpy).not.toHaveBeenCalled();
    expect(randomSpy).toHaveBeenCalledTimes(1);
  });

  it("out-of-range rates clamp toward COLLECTION — a bogus rate never silently disables telemetry", () => {
    // NaN → clamped to 1.0: always in sample.
    vi.spyOn(Math, "random").mockReturnValue(0.999999);
    initWebVitals({ sampleRate: Number.NaN });
    expect(allSubscriptions()).toBe(5);

    // 2 (> 1) → clamped to 1.0: always in sample.
    initWebVitals({ sampleRate: 2 });
    expect(allSubscriptions()).toBe(10); // 5 + 5 across the two inits
  });

  it("the coin is flipped once per session, never per metric — 0.5 with a constant roll is ALL-or-nothing", () => {
    // Roll lands INSIDE the sample (0.4 < 0.5): every family subscribes.
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.4);
    initWebVitals({ sampleRate: 0.5 });
    expect(allSubscriptions()).toBe(5);
    expect(randomSpy).toHaveBeenCalledTimes(1);

    // Roll lands OUTSIDE (0.5 >= 0.5 — the boundary itself is out): none.
    onCLS.mockClear();
    onFCP.mockClear();
    onINP.mockClear();
    onLCP.mockClear();
    onTTFB.mockClear();
    randomSpy.mockClear();
    randomSpy.mockReturnValue(0.5);
    initWebVitals({ sampleRate: 0.5 });
    expect(allSubscriptions()).toBe(0);
    expect(randomSpy).toHaveBeenCalledTimes(1);
  });
});
