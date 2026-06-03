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
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});

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
