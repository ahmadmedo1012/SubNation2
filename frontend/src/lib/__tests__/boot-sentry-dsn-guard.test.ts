import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 97-F6 (R97 J-3): Sentry DSN dead-weight guard.
 *
 * Live production (R97-A1 §3.5 [46]) fetched the vendor-sentry chunk
 * (~151 KB brotli) at boot even though VITE_SENTRY_DSN is unset. The fix
 * in src/lib/boot-sentry.ts makes the dynamic import of ../instrument
 * reachable ONLY from the DSN-present branch:
 *
 *   - DSN unset  → scheduleSentryBoot() never imports the SDK at all
 *                  (no instrument, no @sentry/react), logs the operator
 *                  warning, and installs the __sentryStatus debug handle.
 *   - DSN set    → the idle-time dynamic import path runs exactly as
 *                  before (instrument → @sentry/react → init).
 *
 * The module reads import.meta.env.VITE_SENTRY_DSN at evaluation time, so
 * each test stubs the env and re-imports the module (vi.resetModules) to
 * simulate the two build flavors. ../instrument and @sentry/react are
 * mocked so "was the SDK graph entered?" is observable without loading
 * the real 150 KB SDK.
 */

const state = vi.hoisted(() => ({ instrumentLoaded: false }));

vi.mock("../../instrument", () => {
  state.instrumentLoaded = true;
  return {};
});

vi.mock("@sentry/react", () => ({
  captureException: vi.fn(),
  withScope: vi.fn(),
}));

/** Let the setTimeout/requestIdleCallback fallback + dynamic imports settle. */
async function flushBoot(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

beforeEach(() => {
  state.instrumentLoaded = false;
  vi.resetModules();
  delete (window as { __sentryStatus?: unknown }).__sentryStatus;
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("scheduleSentryBoot — VITE_SENTRY_DSN unset (J-3)", () => {
  it("never imports ../instrument (the Sentry SDK graph stays closed)", async () => {
    const { scheduleSentryBoot, SENTRY_DSN_SET } = await import("../boot-sentry");

    expect(SENTRY_DSN_SET).toBe(false);

    scheduleSentryBoot();
    await flushBoot();

    expect(state.instrumentLoaded).toBe(false);
  });

  it("still surfaces the operator warning without loading the SDK", async () => {
    const { scheduleSentryBoot } = await import("../boot-sentry");

    scheduleSentryBoot();
    await flushBoot();

    // MODE is "test" (not production) → the info-level branch.
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining("VITE_SENTRY_DSN"));
    expect(state.instrumentLoaded).toBe(false);
  });

  it("installs a truthful window.__sentryStatus debug handle", async () => {
    const { scheduleSentryBoot } = await import("../boot-sentry");

    expect(typeof window.__sentryStatus).not.toBe("function");

    scheduleSentryBoot();
    await flushBoot();

    expect(typeof window.__sentryStatus).toBe("function");
    expect(window.__sentryStatus?.()).toMatchObject({
      initialized: false,
      dsn: null,
    });
  });
});

describe("scheduleSentryBoot — VITE_SENTRY_DSN set (behavior preserved)", () => {
  it("dynamic-imports ../instrument on idle exactly as before", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", "https://public@dsn.example.com/1");

    const { scheduleSentryBoot, SENTRY_DSN_SET } = await import("../boot-sentry");

    expect(SENTRY_DSN_SET).toBe(true);

    scheduleSentryBoot();
    await flushBoot();

    expect(state.instrumentLoaded).toBe(true);
  });

  it("whitespace-only DSN values are treated as unset", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", "   ");

    const { scheduleSentryBoot, SENTRY_DSN_SET } = await import("../boot-sentry");

    expect(SENTRY_DSN_SET).toBe(false);

    scheduleSentryBoot();
    await flushBoot();

    expect(state.instrumentLoaded).toBe(false);
  });
});
