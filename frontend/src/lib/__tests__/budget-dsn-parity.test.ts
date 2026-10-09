// @vitest-environment node
//
// NODE env (not jsdom) on purpose — same reason as preload-gate.test.ts:
// this suite imports vite.config.ts (the parity constants + pure
// predicate live there — single source of truth), which transitively
// loads vite/esbuild; esbuild asserts a TextEncoder/Uint8Array realm
// invariant that vitest's jsdom environment breaks.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PLACEHOLDER_BUDGET_SENTRY_DSN, shouldSubstituteBudgetDsn } from "../../../vite.config";

/**
 * R127-L10 (B4 D1): budget-gate DSN parity.
 *
 * B4's live measurement (docs/inspection-r127/B4-live-performance.md §D):
 * the deployed DSN build's eager path is 148,042 B gz — 438 B under the
 * 145 KiB warn line — while CI's gate measured the 2,325 B-lighter
 * no-DSN build (145,717 B). The gate was structurally blind to
 * production reality. The fix substitutes a placeholder DSN for CI
 * builds with no DSN configured, so the emitted bytes (and therefore
 * the gate's measurement) are production-shaped.
 *
 * These tests pin:
 *
 *   1. the substitution's truth table (the pure predicate);
 *   2. the placeholder's shape (realistic DSN, RFC 2606 .invalid host —
 *      an artifact that can never report anywhere);
 *   3. the VITEST guard — importing the config under the test runner
 *      must NOT mutate process.env (a CI-only VITE_SENTRY_DSN would
 *      leak into sibling suites like boot-sentry-dsn-guard's "unset"
 *      cases and diverge CI from local runs);
 *   4. the physical ordering of the config — the substitution block
 *      must execute before `sentryDsnConfigured` is resolved, or the
 *      whole fix silently no-ops (the guard would read the
 *      pre-substitution env).
 */

const configPath = resolve(process.cwd(), "vite.config.ts");
const configText = readFileSync(configPath, "utf8");

describe("R127-L10 (B4 D1): shouldSubstituteBudgetDsn — substitution truth table", () => {
  it("substitutes for a CI build with no DSN configured (the fix's target case)", () => {
    expect(shouldSubstituteBudgetDsn({ CI: "true", VITE_SENTRY_DSN: undefined })).toBe(true);
  });

  it("never substitutes outside CI (local no-DSN builds keep the lean 97-F6 stub shape)", () => {
    expect(shouldSubstituteBudgetDsn({ CI: undefined })).toBe(false);
    expect(shouldSubstituteBudgetDsn({ CI: "false" })).toBe(false);
  });

  it("never substitutes when a real DSN is configured (production builds are untouched)", () => {
    expect(
      shouldSubstituteBudgetDsn({
        CI: "true",
        VITE_SENTRY_DSN: "https://abc@o0.ingest.sentry.io/123",
      }),
    ).toBe(false);
  });

  it("treats whitespace-only DSN values as unset (the app's own trim semantics)", () => {
    expect(shouldSubstituteBudgetDsn({ CI: "true", VITE_SENTRY_DSN: "   " })).toBe(true);
  });

  it("never substitutes under vitest, even with CI set — the test-worker leak guard", () => {
    expect(
      shouldSubstituteBudgetDsn({ CI: "true", VITEST: "true", VITE_SENTRY_DSN: undefined }),
    ).toBe(false);
  });
});

describe("R127-L10 (B4 D1): the placeholder DSN's shape", () => {
  it("is a realistic Sentry DSN (32-hex key @ ingest host / project id)", () => {
    expect(PLACEHOLDER_BUDGET_SENTRY_DSN).toMatch(/^https:\/\/[0-9a-f]{32}@[a-z0-9.-]+\/\d+$/);
  });

  it("is of realistic length (the DSN string rides the entry chunk — a toy value would under-measure)", () => {
    expect(PLACEHOLDER_BUDGET_SENTRY_DSN.length).toBeGreaterThanOrEqual(70);
    expect(PLACEHOLDER_BUDGET_SENTRY_DSN.length).toBeLessThanOrEqual(95);
  });

  it("points at the RFC 2606 reserved .invalid TLD — a CI artifact can never report anywhere", () => {
    expect(new URL(PLACEHOLDER_BUDGET_SENTRY_DSN).hostname.endsWith(".invalid")).toBe(true);
  });
});

describe("R127-L10 (B4 D1): config-load safety (this suite IS the leak probe)", () => {
  it("importing vite.config.ts under vitest did not mutate process.env.VITE_SENTRY_DSN", () => {
    // This file statically imports the config at the top — if the
    // VITEST guard ever regresses, CI runs of THIS suite (CI=true) would
    // perform the substitution at import time and every assertion about
    // sibling "DSN unset" suites starts lying. Pin the invariant.
    expect(process.env.VITE_SENTRY_DSN).not.toBe(PLACEHOLDER_BUDGET_SENTRY_DSN);
  });
});

describe("R127-L10 (B4 D1): substitution ordering (source pin)", () => {
  it("the parity block executes before sentryDsnConfigured is resolved", () => {
    // If the substitution block ever moves below the
    // `const sentryDsnConfigured` resolution, the guard reads the
    // PRE-substitution env and the whole fix silently no-ops — the
    // budget gate would go back to measuring the no-DSN shape while
    // every test above still passes.
    const substitutionAt = configText.indexOf("const budgetDsnParitySubstituted =");
    const guardAt = configText.indexOf("const sentryDsnConfigured =");
    expect(substitutionAt).toBeGreaterThan(0);
    expect(guardAt).toBeGreaterThan(substitutionAt);
  });
});
