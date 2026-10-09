import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 97-F6 (R97 J-3): Sentry DSN dead-weight guard + R127-L10 (B4 D2):
 * vendor-sentry load-window deferral.
 *
 * Live production (R97-A1 §3.5 [46]) fetched the vendor-sentry chunk
 * (~151 KB brotli) at boot even though VITE_SENTRY_DSN is unset. The fix
 * in src/lib/boot-sentry.ts makes the dynamic import of ../instrument
 * reachable ONLY from the DSN-present branch:
 *
 *   - DSN unset  → scheduleSentryBoot() never imports the SDK at all
 *                  (no instrument, no @sentry/react), logs the operator
 *                  warning, and installs the __sentryStatus debug handle.
 *   - DSN set    → the R127-L10 (B4 D2) replay-roll-aware schedule:
 *                  sticky session-replay WINNERS (stored roll "1") idle-
 *                  import the SDK exactly as before; everyone else
 *                  (~90%, who only ever need the SDK on error) defers
 *                  the import to the LATER of the window load event /
 *                  the first pointerdown — B4 measured the 111,295 B br
 *                  chunk riding INSIDE the load window on every route
 *                  (70% unused, a 221 ms long task in the LCP phase)
 *                  because rIC fires during the window on mid-tier
 *                  mobile, not after it.
 *
 * The error-path guarantee (the reason the deferral is safe): the
 * synchronous buffer (§1–2 of boot-sentry's docblock) still captures
 * every pre-load event, the FIRST buffered error imports the SDK
 * immediately, and the buffer drains to captureException the moment
 * the chunk lands.
 *
 * OBSERVABILITY (how these tests read the boot schedule's state):
 * vi.mock factories run ONCE per test file, so after vi.resetModules()
 * a factory side effect cannot observe per-test imports. Two channels
 * are used instead, each honest about what it proves:
 *
 *   1. __sentryBootStateForTests() (exported by boot-sentry for exactly
 *      this suite — same convention as use-public-auth-providers'
 *      __reset…ForTests): reads the module's own decision state. Used
 *      for ALL negative assertions ("the SDK has NOT loaded") — a
 *      buffered probe error CANNOT be used there, because on the
 *      deferred path the first buffered error itself trips the
 *      first-error short-circuit (the very behavior under test): the
 *      probe would load the SDK and then honestly report it live.
 *
 *   2. A probe error + the stable hoisted @sentry/react mock refs:
 *      once ready, a NEW buffered event flushes SYNCHRONOUSLY through
 *      withScope → captureException — used ONLY for positive
 *      "the SDK is live" assertions, after (1) already proved it.
 *
 * Each test stubs the env and re-imports the module (vi.resetModules)
 * to simulate the two build flavors. ../instrument and @sentry/react
 * are mocked so "was the SDK graph entered?" is observable without
 * loading the real 150 KB SDK.
 */

const state = vi.hoisted(() => ({
  // Stable mock refs: the vi.mock factory returns these exact
  // references on every (cached or fresh) module-graph resolution, so
  // assertions work across vi.resetModules().
  captureException: vi.fn(),
  withScope: vi.fn((cb: (scope: unknown) => void) => {
    cb({ setTag: () => {}, setContext: () => {} });
  }),
}));

vi.mock("../../instrument", () => ({}));

vi.mock("@sentry/react", () => ({
  captureException: state.captureException,
  withScope: state.withScope,
}));

/** Let the setTimeout/requestIdleCallback fallback + dynamic imports settle. */
async function flushBoot(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

/**
 * Probe whether the SDK is LIVE for the CURRENT boot-sentry module
 * instance: a fresh react-kind error. While the SDK is unloaded it
 * lands in the buffer (captureException NOT called); once a load path
 * has fired and start()'s chain settled, it flushes synchronously
 * through the stable withScope/captureException refs.
 *
 * POSITIVE-assertion-only helper: on the DEFERRED path the first
 * buffered error itself triggers the SDK load (the B4 D2 first-error
 * short-circuit), so "not called" outcomes CANNOT be probed this way —
 * use __sentryBootStateForTests() for those (see the file docblock).
 */
async function probeSdkLive(
  boot: typeof import("../boot-sentry"),
  label: string,
): Promise<void> {
  state.captureException.mockClear();
  state.withScope.mockClear();
  boot.bufferedReactErrorHandler()(new Error(label), { componentStack: "<Probe>" });
  await flushBoot();
}

/**
 * jsdom's document.readyState is "complete" by default, so an armed
 * deferred load needs ONLY a pointerdown. Dispatching one after the
 * assertions also DISARMS the listeners each test armed (the jsdom
 * window is shared across this file's tests — a lingering armed
 * listener from an earlier test would fire on a later test's events
 * and break isolation).
 */
async function disarmDeferredListeners(): Promise<void> {
  window.dispatchEvent(new Event("pointerdown"));
  await flushBoot();
}

beforeEach(() => {
  state.captureException.mockClear();
  state.withScope.mockClear();
  vi.resetModules();
  sessionStorage.clear();
  delete (window as { __sentryStatus?: unknown }).__sentryStatus;
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("scheduleSentryBoot — VITE_SENTRY_DSN unset (J-3)", () => {
  it("never enters the SDK graph — a boot-window error stays buffered, nothing loads", async () => {
    const boot = await import("../boot-sentry");

    expect(boot.SENTRY_DSN_SET).toBe(false);

    boot.scheduleSentryBoot();
    await flushBoot();
    await probeSdkLive(boot, "no-dsn probe");
    expect(state.captureException).not.toHaveBeenCalled();
  });

  it("still surfaces the operator warning without loading the SDK", async () => {
    const { scheduleSentryBoot } = await import("../boot-sentry");

    scheduleSentryBoot();
    await flushBoot();

    // MODE is "test" (not production) → the info-level branch.
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining("VITE_SENTRY_DSN"));
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

describe("scheduleSentryBoot — VITE_SENTRY_DSN set (97-F6 behavior preserved)", () => {
  it("whitespace-only DSN values are treated as unset", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", "   ");

    const boot = await import("../boot-sentry");

    expect(boot.SENTRY_DSN_SET).toBe(false);

    boot.scheduleSentryBoot();
    await flushBoot();
    await probeSdkLive(boot, "whitespace probe");
    expect(state.captureException).not.toHaveBeenCalled();
  });
});

describe("scheduleSentryBoot — R127-L10 (B4 D2) replay-roll-aware schedule", () => {
  it("sticky session winners (stored roll \"1\") keep the idle boot — SDK live with no engagement", async () => {
    // MODE=production gives the roll its 0.1 rate so the stored verdict
    // is read (same idiom as instrument-replay-lazy's winner suite; in
    // test/dev the rate is 0 and every session is non-sampled).
    vi.stubEnv("MODE", "production");
    vi.stubEnv("VITE_SENTRY_DSN", "https://public@dsn.example.com/1");
    sessionStorage.setItem("sn:sentry-replay-roll", "1");

    const boot = await import("../boot-sentry");

    expect(boot.SENTRY_DSN_SET).toBe(true);

    boot.scheduleSentryBoot();
    // jsdom has no requestIdleCallback → the setTimeout(0) fallback
    // fires inside flushBoot — the winner's SDK must be READY with no
    // engagement at all (the gate is never armed for winners).
    await flushBoot();
    expect(boot.__sentryBootStateForTests()).toEqual({
      ready: true,
      deferredGateArmed: false,
    });
    await probeSdkLive(boot, "winner probe");
    expect(state.captureException).toHaveBeenCalled();
  });

  it("non-sampled sessions (no roll, non-production rate 0) do NOT load on idle — and stay ARMED on the deferred gate", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", "https://public@dsn.example.com/1");

    const boot = await import("../boot-sentry");

    boot.scheduleSentryBoot();
    // rIC / setTimeout(0) all settle — the SDK must stay out of the
    // load window (idle fires DURING it on mid-tier mobile,
    // live-measured), with the later-of gate ARMED as the reason.
    await flushBoot();
    expect(boot.__sentryBootStateForTests()).toEqual({
      ready: false,
      deferredGateArmed: true,
    });

    // jsdom's readyState is "complete" → the load half is satisfied;
    // the first pointerdown completes the gate (the cleanup doubles
    // as the positive assertion — nothing dangles after the fire).
    window.dispatchEvent(new Event("pointerdown"));
    await flushBoot();
    expect(boot.__sentryBootStateForTests()).toEqual({
      ready: true,
      deferredGateArmed: false,
    });
  });

  it("a stored losing roll (\"0\", production rate) stays deferred on idle", async () => {
    // MODE=production + a stored "0" verdict — the mirror of the
    // winner test above: the sticky roll is READ in production mode,
    // and a recorded loser defers even there (90% of sessions).
    vi.stubEnv("MODE", "production");
    vi.stubEnv("VITE_SENTRY_DSN", "https://public@dsn.example.com/1");
    sessionStorage.setItem("sn:sentry-replay-roll", "0");

    const boot = await import("../boot-sentry");

    boot.scheduleSentryBoot();
    await flushBoot();
    expect(boot.__sentryBootStateForTests()).toEqual({
      ready: false,
      deferredGateArmed: true,
    });
    await disarmDeferredListeners();
  });

  it("the deferred load fires once BOTH the load event and a pointerdown happened (already-loaded document)", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", "https://public@dsn.example.com/1");

    const boot = await import("../boot-sentry");

    boot.scheduleSentryBoot();
    await flushBoot();
    // jsdom readyState is "complete" → `loaded` is already true; only
    // the engagement half of the gate is missing.
    expect(boot.__sentryBootStateForTests()).toEqual({
      ready: false,
      deferredGateArmed: true,
    });

    window.dispatchEvent(new Event("pointerdown"));
    await flushBoot();
    expect(boot.__sentryBootStateForTests()).toEqual({
      ready: true,
      deferredGateArmed: false,
    });
    await probeSdkLive(boot, "post-pointerdown probe");
    expect(state.captureException).toHaveBeenCalled();
  });

  it("an early pointerdown (before load) does not import — the load event completes the gate", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", "https://public@dsn.example.com/1");
    // Simulate a boot still inside the initial load window.
    vi.spyOn(document, "readyState", "get").mockReturnValue("loading");

    const boot = await import("../boot-sentry");

    boot.scheduleSentryBoot();

    // The visitor taps during the load window — engagement alone must
    // not pull 111 KB br into contention with the LCP resources.
    window.dispatchEvent(new Event("pointerdown"));
    await flushBoot();
    expect(boot.__sentryBootStateForTests()).toEqual({
      ready: false,
      deferredGateArmed: true,
    });

    // The load event ends the window → the later-of gate is satisfied.
    window.dispatchEvent(new Event("load"));
    await flushBoot();
    expect(boot.__sentryBootStateForTests()).toEqual({
      ready: true,
      deferredGateArmed: false,
    });
    await probeSdkLive(boot, "post-load probe");
    expect(state.captureException).toHaveBeenCalled();
  });

  it("the FIRST buffered error loads the SDK immediately — no engagement needed", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", "https://public@dsn.example.com/1");

    const boot = await import("../boot-sentry");

    boot.scheduleSentryBoot();
    await flushBoot();
    // Deferred + armed, nothing loaded yet.
    expect(boot.__sentryBootStateForTests()).toEqual({
      ready: false,
      deferredGateArmed: true,
    });

    // The early crash fires while the SDK is still deferred…
    boot.bufferedReactErrorHandler()(new Error("early crash"), { componentStack: "<Boot>" });
    await flushBoot();

    // …and the SDK is live right after — the gate is GONE (disarmed by
    // the error trigger) and a second error flushes directly (no
    // buffer, no engagement).
    expect(boot.__sentryBootStateForTests()).toEqual({
      ready: true,
      deferredGateArmed: false,
    });
    state.captureException.mockClear();
    boot.bufferedReactErrorHandler()(new Error("second error"), { componentStack: "<Boot>" });
    await flushBoot();
    expect(state.captureException).toHaveBeenCalledWith(new Error("second error"));
  });

  it("the buffered early crash still reaches Sentry once the deferred chunk lands (the §1–2 guarantee)", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", "https://public@dsn.example.com/1");

    const boot = await import("../boot-sentry");

    boot.scheduleSentryBoot();

    // An error fires while the SDK is still deferred…
    const crash = new Error("early crash");
    boot.bufferedReactErrorHandler()(crash, { componentStack: "<Boot>" });
    await flushBoot();

    // …the error-triggered import landed the chunk AND the buffered
    // event drained through withScope → captureException (react kind).
    expect(state.withScope).toHaveBeenCalled();
    expect(state.captureException).toHaveBeenCalledWith(crash);
  });

  it("an error buffered BEFORE the schedule arms loads the SDK at arm time (early-crash guarantee, belt-and-braces)", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", "https://public@dsn.example.com/1");

    const boot = await import("../boot-sentry");

    // main.tsx installs the window listeners and schedules the boot in
    // one synchronous block, so this ordering cannot happen today —
    // but the arm-time buffer check makes the early-crash guarantee
    // independent of call order. Pin it.
    const crash = new Error("pre-schedule crash");
    boot.bufferedReactErrorHandler()(crash, { componentStack: "<Boot>" });

    boot.scheduleSentryBoot();
    await flushBoot();

    // The pre-existing buffered error short-circuits the gate at arm
    // time — no load event, no pointerdown, SDK ready + drained.
    expect(boot.__sentryBootStateForTests()).toEqual({
      ready: true,
      deferredGateArmed: false,
    });
    expect(state.captureException).toHaveBeenCalledWith(crash);
  });
});
