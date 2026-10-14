import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireThrottledMaintenance, HUNG_RUN_FLOOR_MS } from "../opportunistic";
import { logger } from "../logger";

/**
 * R143 (L14-1) — the opportunistic throttle regression suite.
 *
 * L-2 (R142) landed the hung-run floor + entry-capture re-arm in
 * lib/opportunistic.ts with the doc comment "Exported for the unit
 * test" — but no such test ever existed (the R142 wave report claimed
 * one did). Five retention/sweep jobs' only recurring trigger rides on
 * ~40 lines of stateful logic with zero direct tests: a regression in
 * the re-entry guard, the throttle window, the 10-minute hung floor, or
 * the stale-`finally`/re-arm interaction would ship green.
 *
 * This file pins the full L-2 contract (fake timers drive Date.now):
 *
 *   1. first call runs; second call inside the window is a no-op;
 *   2. an in-flight run blocks twins (with the visible debug skip log);
 *   3. a FAILED run still throttles (the window is measured from start,
 *      not success);
 *   4. a thrown body never rejects to the caller (warn-logged);
 *   5. a run still marked in-flight after HUNG_RUN_FLOOR_MS re-arms
 *      instead of disabling the job until restart — MUTATION-GRADE:
 *      removing the floor fails this leg;
 *   6. a stale promise settling AFTER a re-arm cannot clear the new
 *      entry's flag (the entry-object capture) — MUTATION-GRADE: a
 *      registry re-read in the finally fails this leg.
 */

/** Deferred promise handle for simulating hung bodies. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Flush the fire-and-forget body's microtask chain (settles non-hung runs). */
async function flush(times = 3): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

let debugSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  debugSpy = vi.spyOn(logger, "debug").mockImplementation(() => {});
  warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("R143 (L14-1): fireThrottledMaintenance — the L-2 contract", () => {
  it("the exported floor is the documented 10 minutes", () => {
    expect(HUNG_RUN_FLOOR_MS).toBe(10 * 60_000);
  });

  it("first call runs; a second call inside the window is a throttled no-op", async () => {
    let ran = 0;
    expect(
      fireThrottledMaintenance("l14-basic", 60_000, async () => {
        ran += 1;
      }),
    ).toBe(true);
    await flush(); // body settles → inFlight=false

    expect(fireThrottledMaintenance("l14-basic", 60_000, async () => {})).toBe(false);
    expect(ran).toBe(1);

    // Past the window the job is eligible again.
    vi.advanceTimersByTime(60_001);
    expect(
      fireThrottledMaintenance("l14-basic", 60_000, async () => {
        ran += 1;
      }),
    ).toBe(true);
    expect(ran).toBe(2);
  });

  it("an in-flight run blocks twins AND emits the visible skip log", () => {
    const gate = deferred();
    let ran = 0;
    expect(
      fireThrottledMaintenance("l14-inflight", 60_000, async () => {
        ran += 1;
        await gate.promise;
      }),
    ).toBe(true);

    // Inside the window AND still executing → skipped, logged.
    expect(fireThrottledMaintenance("l14-inflight", 60_000, async () => {})).toBe(false);
    expect(ran).toBe(1);
    expect(debugSpy).toHaveBeenCalled();
    const logged = debugSpy.mock.calls.map((c: unknown[]) => String(c[c.length - 1])).join(" ");
    expect(logged).toContain("l14-inflight");
    expect(logged).toContain("still in flight");

    gate.resolve();
  });

  it("a FAILED run still throttles — the window is measured from run start, not success", async () => {
    let ran = 0;
    expect(
      fireThrottledMaintenance("l14-failed", 60_000, async () => {
        ran += 1;
        throw new Error("boom");
      }),
    ).toBe(true);
    await flush();
    expect(ran).toBe(1);
    // The failure warn fired (never-throws guarantee)…
    expect(warnSpy).toHaveBeenCalled();
    // …and the next call inside the window is STILL throttled.
    expect(fireThrottledMaintenance("l14-failed", 60_000, async () => {})).toBe(false);
    vi.advanceTimersByTime(60_001);
    expect(
      fireThrottledMaintenance("l14-failed", 60_000, async () => {
        ran += 1;
      }),
    ).toBe(true);
    expect(ran).toBe(2);
  });

  it("a thrown body never rejects to the caller (fire-and-forget holds)", async () => {
    // A rejection escaping the void wrapper would surface as an
    // unhandled rejection and fail the file; assert the happy contract
    // directly instead: the call returns synchronously and the body's
    // failure is warn-logged, not propagated.
    const result = fireThrottledMaintenance("l14-throw", 1_000, async () => {
      throw new Error("kaboom");
    });
    expect(result).toBe(true);
    await flush();
    expect(warnSpy).toHaveBeenCalled();
    const logged = warnSpy.mock.calls.map((c: unknown[]) => String(c[c.length - 1])).join(" ");
    expect(logged).toContain("l14-throw");
    expect(logged).toContain("non-fatal");
  });

  it("MUTATION: a run still in-flight past HUNG_RUN_FLOOR_MS re-arms (the floor is real)", () => {
    const gate = deferred();
    let ran = 0;
    expect(
      fireThrottledMaintenance("l14-floor", 60_000, async () => {
        ran += 1;
        await gate.promise;
      }),
    ).toBe(true);

    // Still inside the floor → skipped (a hung run must not stack twins).
    vi.advanceTimersByTime(HUNG_RUN_FLOOR_MS - 1_000);
    expect(fireThrottledMaintenance("l14-floor", 60_000, async () => {})).toBe(false);
    expect(ran).toBe(1);

    // Past the floor → re-armed (the pre-L-2 shape never recovered: one
    // never-settling fn() disabled the key until process restart).
    vi.advanceTimersByTime(2_000);
    expect(
      fireThrottledMaintenance("l14-floor", 60_000, async () => {
        ran += 1;
      }),
    ).toBe(true);
    expect(ran).toBe(2);

    gate.resolve();
  });

  it("MUTATION: a stale finally after a re-arm cannot clear the NEW entry's flag (entry capture)", async () => {
    const first = deferred();
    let ran = 0;

    // Run #1 — hangs from the caller's perspective.
    expect(
      fireThrottledMaintenance("l14-stale", 60_000, async () => {
        ran += 1;
        await first.promise;
      }),
    ).toBe(true);

    // Run #1 goes "hung": past the floor a re-arm happens.
    vi.advanceTimersByTime(HUNG_RUN_FLOOR_MS + 1_000);
    const second = deferred();
    expect(
      fireThrottledMaintenance("l14-stale", 60_000, async () => {
        ran += 1;
        await second.promise;
      }),
    ).toBe(true);
    expect(ran).toBe(2);

    // NOW the stale run #1 finally settles — its finally writes to the
    // OLD entry object. The registry's CURRENT entry (run #2) must still
    // read in-flight. Advance past run #2's THROTTLE window first so the
    // only thing that can correctly return false here is the in-flight
    // guard: a mutation that clears the NEW entry's flag would re-arm
    // (true) and stack a twin — exactly what L-2's entry capture forbids.
    first.resolve();
    await flush();
    vi.advanceTimersByTime(61_000);
    expect(fireThrottledMaintenance("l14-stale", 60_000, async () => {})).toBe(false);
    expect(ran).toBe(2);

    // And when run #2 settles normally, the key unblocks for the next
    // window — the re-arm did not wedge the registry either.
    second.resolve();
    await flush();
    vi.advanceTimersByTime(60_001);
    expect(
      fireThrottledMaintenance("l14-stale", 60_000, async () => {
        ran += 1;
      }),
    ).toBe(true);
    expect(ran).toBe(3);
  });
});
