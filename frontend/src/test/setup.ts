/**
 * Frontend vitest setup — runs once per test file before tests start.
 *
 * Adds:
 *   - @testing-library/jest-dom matchers (toBeInTheDocument, etc.) so
 *     tests can assert on DOM state in a human-readable way.
 *   - afterEach DOM cleanup so a previous test's render does not leak
 *     into the next test's queries.
 *   - crypto.randomUUID polyfill: jsdom 27+ ships with one, but a hard
 *     guard means a future jsdom downgrade would not silently break the
 *     idempotency-key generator under test.
 *
 * IMPORTANT: this setup is loaded by `vitest.config.ts` via setupFiles.
 * Keep it small — anything that imports React or component code here
 * would slow down EVERY test boot.
 */
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup, configure } from "@testing-library/react";

// R132 (test-truth): raise testing-library's asyncUtilTimeout (the
// default patience of every waitFor/findBy*) from 1 s to 5 s, in line
// with the 10 s vitest testTimeout budget. The 1 s default is sized
// for an idle machine; under the full 180-file jsdom suite's CPU
// contention a healthy render+query+fetch-mock cycle can exceed it and
// the test flakes (the R130/R131 load-flaky class: admin-layout-alerts
// passed 11/11 in isolation while failing in the full run — a
// pass-individually/fail-together trap). This changes NO assertion —
// only how long the utilities keep polling before giving up — and it
// keeps the patience bound well under the testTimeout that catches
// genuinely hung tests.
configure({ asyncUtilTimeout: 5_000 });

afterEach(() => {
  cleanup();
});

// R145 (Motion): jsdom ships no IntersectionObserver, and motion/react's
// viewport features (whileInView) construct one on mount with NO guard
// (unlike the app's own use-on-screen hook). Without this stub every
// jsdom render of a motion-bearing page crashed with
// "IntersectionObserver is not defined". The stub fires
// isIntersecting: true immediately on observe so reveal content lands
// in its SHOWN state — deterministic for every consumer (the app's
// use-on-screen reads the same callback and settles onScreen=true,
// its documented initial state).
if (typeof globalThis.IntersectionObserver === "undefined") {
  class IntersectionObserverStub implements IntersectionObserver {
    readonly root: Element | Document | null = null;
    readonly rootMargin: string = "0px";
    readonly thresholds: ReadonlyArray<number> = [0];
    constructor(private readonly callback: IntersectionObserverCallback) {}
    observe(target: Element): void {
      const entry = {
        isIntersecting: true,
        intersectionRatio: 1,
        target,
        time: 0,
        boundingClientRect: (target as HTMLElement).getBoundingClientRect?.() ?? {
          top: 0,
          left: 0,
          bottom: 0,
          right: 0,
          width: 0,
          height: 0,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        },
        intersectionRect: {
          top: 0,
          left: 0,
          bottom: 0,
          right: 0,
          width: 0,
          height: 0,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        },
        rootBounds: null,
      } as unknown as IntersectionObserverEntry;
      this.callback([entry], this as unknown as IntersectionObserver);
    }
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }
  (globalThis as unknown as Record<string, unknown>).IntersectionObserver =
    IntersectionObserverStub;
}

// jsdom 27 includes crypto.randomUUID, but provide a defensive
// fallback so a jsdom downgrade or a non-standard test environment
// does not silently break tests that depend on the idempotency-key
// helper. Production browsers SubNation supports already have this
// natively — see frontend/src/lib/idempotency.ts file header.
if (
  typeof globalThis.crypto !== "undefined" &&
  typeof globalThis.crypto.randomUUID !== "function" &&
  typeof globalThis.crypto.getRandomValues === "function"
) {
  // Minimal RFC 4122 v4 implementation — only used in test
  // environments that lack the native API.
  Object.defineProperty(globalThis.crypto, "randomUUID", {
    configurable: true,
    value: function randomUUID(): `${string}-${string}-${string}-${string}-${string}` {
      const bytes = new Uint8Array(16);
      globalThis.crypto.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
      bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx
      const hex: string[] = [];
      for (const b of bytes) {
        hex.push(b.toString(16).padStart(2, "0"));
      }
      return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}` as `${string}-${string}-${string}-${string}-${string}`;
    },
  });
}
