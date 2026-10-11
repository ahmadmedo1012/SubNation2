import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkNeonWith, resetNeonFailureStreakForTests } from "../health";

/**
 * R118-A5 TOP-20 #6 [P2] — checkNeonWith warmup probe (R117 A4-P2).
 *
 * `checkNeonWith` is exported for unit tests (health.ts:241) but had ZERO
 * tests — the cold-resume fix it carries was unpinned:
 *
 *   1. cold-resume shape — a ~550 ms FIRST probe (Neon auto-suspend
 *      resume penalty) followed by a 5 ms measured probe reads "ok",
 *      NOT "degraded": the unmeasured warmup probe absorbs the resume so
 *      the 500 ms latency threshold only judges steady-state;
 *   2. a genuinely failing probe escalates — the warmup failure is NOT
 *      swallowed; the measured probe fails with normal semantics
 *      (degraded on the 1st consecutive miss, failing at the
 *      NEON_FAILURES_TO_FAILING=2 streak — /healthz/summary 503);
 *   3. a slow steady-state probe still reads "degraded" (> 500 ms) —
 *      the warmup exemption must not mask real steady-state latency;
 *   4. a success resets the consecutive-failure streak (the streak is
 *      "consecutive" by definition — see checkNeonWith success branch).
 *
 * REDIS_URL is kept unset so the redis-side failure counters no-op and
 * the in-process streak is the authority (the documented no-Redis
 * production shape).
 */

/**
 * R132 (test-truth): the three latency-JUDGING tests now run under FAKE
 * TIMERS. They used to sleep real milliseconds and assert on
 * `Date.now()` deltas (e.g. "the 5 ms measured probe reads < 500 ms"),
 * which is only true while the event loop is timely — under the full
 * 242-file suite's CPU contention the loop can stall > 500 ms between
 * timer setup and firing, and a HEALTHY probe shape read "degraded"
 * (the load-flaky class R130/R131 recorded: passes 5/5 in isolation,
 * fails in the full run — a pass-individually/fail-together trap that
 * said nothing about the code). Under vi.useFakeTimers() the clock
 * advances EXACTLY with advanceTimersByTimeAsync, so the measured
 * latency is the probe's nominal sleep — deterministic at any load.
 * The failure-streak tests (no wall-clock dependence) keep real timers.
 */

const ENV_KEYS = ["REDIS_URL", "HEALTH_CHECK_TIMEOUT_MS"] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  resetNeonFailureStreakForTests();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  resetNeonFailureStreakForTests();
});

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Probe stub: the result of `neonDb.execute(sql`SELECT 1`)` is truthy. */
const TRUTHY_RESULT = { rows: [{ "?column?": 1 }] };

/** Cold-resume shape: first call pays the suspend-resume penalty, later calls are warm. */
function coldThenWarmProbe(coldMs: number, warmMs: number): () => Promise<unknown> {
  let calls = 0;
  return async () => {
    calls += 1;
    await sleep(calls === 1 ? coldMs : warmMs);
    return TRUTHY_RESULT;
  };
}

function alwaysFailingProbe(): () => Promise<unknown> {
  return async () => {
    throw new Error("neon unreachable (connection refused)");
  };
}

function steadyProbe(ms: number): () => Promise<unknown> {
  return async () => {
    await sleep(ms);
    return TRUTHY_RESULT;
  };
}

describe("checkNeonWith — warmup probe (R117 A4-P2 / R118-A5 #6)", () => {
  it("cold-resume shape: a 550 ms first probe then a 5 ms measured probe → ok, NOT degraded", async () => {
    // The 550 ms cold probe is SLOWER than the 500 ms degraded threshold —
    // before R117 A4-P2 this exact shape flapped /healthz/summary
    // "degraded" on every cold aggregate of an otherwise healthy idle
    // store. The warmup probe absorbs the resume; only the measured 5 ms
    // probe is judged.
    // R132: fake clock — the measured latency is EXACTLY 5 ms, not
    // "5 ms + however long the loaded event loop stalled".
    vi.useFakeTimers();
    try {
      const pending = checkNeonWith(coldThenWarmProbe(550, 5));
      // 550 (warmup) + 5 (measured) on the fake clock; the internal
      // 5 s race timeouts never fire (5000 ≫ 555).
      await vi.advanceTimersByTimeAsync(600);
      const result = await pending;
      expect(result.status).toBe("ok");
      expect(result.latencyMs).toBeLessThan(500);
      expect(result.error).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a genuinely failing probe escalates: degraded on the first miss, failing at the 2-streak — the warmup failure is not swallowed", async () => {
    const probe = alwaysFailingProbe();
    const first = await checkNeonWith(probe);
    // 1st consecutive failure → degraded (not yet failing).
    expect(first.status).toBe("degraded");
    expect(first.error).toBe("neon unreachable (connection refused)");

    const second = await checkNeonWith(probe);
    // 2nd consecutive failure → failing (NEON_FAILURES_TO_FAILING = 2 —
    // this is the verdict that flips /healthz/summary to 503).
    expect(second.status).toBe("failing");
    expect(second.error).toBe("neon unreachable (connection refused)");
  });

  it("a slow steady-state probe still reads degraded (the warmup exemption does not mask real latency)", async () => {
    // BOTH the warmup and the measured probe are slow — steady-state
    // latency, not a cold resume — so the measured 600 ms must be judged
    // against the 500 ms threshold.
    // R132: fake clock — exactly 600 ms judged, deterministically.
    vi.useFakeTimers();
    try {
      const pending = checkNeonWith(steadyProbe(600));
      await vi.advanceTimersByTimeAsync(1300);
      const result = await pending;
      expect(result.status).toBe("degraded");
      expect(result.latencyMs).toBeGreaterThanOrEqual(500);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a success resets the consecutive-failure streak (outage → recovery → brief blip stays degraded, not failing)", async () => {
    // R132: the recovery leg judges a fast probe's latency (the old real
    // sleep made its "ok" verdict load-flaky) — run the whole scenario
    // on the fake clock: failures are instant (no timers), the recovery
    // probe sleeps 1 ms twice.
    vi.useFakeTimers();
    try {
      // 1st failure: streak 1 → degraded.
      let pending = checkNeonWith(alwaysFailingProbe());
      await vi.advanceTimersByTimeAsync(0);
      expect((await pending).status).toBe("degraded");
      // Recovery: a fast successful probe resets the streak.
      pending = checkNeonWith(coldThenWarmProbe(1, 1));
      await vi.advanceTimersByTimeAsync(5);
      const ok = await pending;
      expect(ok.status).toBe("ok");
      // A NEW single failure starts a fresh streak → degraded again, NOT
      // failing (pre-escalation — the streak is consecutive by definition).
      pending = checkNeonWith(alwaysFailingProbe());
      await vi.advanceTimersByTimeAsync(0);
      expect((await pending).status).toBe("degraded");
    } finally {
      vi.useRealTimers();
    }
  });

  it('a probe that resolves FALSY is an honest failure ("Query returned no result"), not a fake ok', async () => {
    const falsyProbe = async () => null;
    const result = await checkNeonWith(falsyProbe);
    expect(result.status).toBe("degraded");
    expect(result.error).toBe("Query returned no result");
  });
});
