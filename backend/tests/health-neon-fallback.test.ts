import { beforeEach, describe, expect, it } from "vitest";
import { checkNeonWith, resetNeonFailureStreakForTests } from "../src/routes/health";

/**
 * B7-P1-4 (round-92): the Neon failure counters lived ONLY in Redis — with
 * REDIS_URL unset (current production shape), `incrementFailureCounter`
 * no-ops and a TOTAL database outage kept /healthz/summary at HTTP 200
 * forever ("degraded", failures=0). Health was not truthful about the one
 * dependency that matters.
 *
 * These tests pin the in-process consecutive-failure fallback: N=2
 * consecutive failed checks escalate the neon check to "failing", which
 * computeReadyState folds into an overall "failing" status → 503 on
 * /healthz/summary.
 *
 * checkNeonWith takes an injectable probe because the real probe
 * (`neonDb.execute(sql`SELECT 1`)`) cannot be made to fail deterministically
 * in the pglite harness.
 */

function failingProbe(): Promise<never> {
  return Promise.reject(new Error("neon: connection terminated"));
}

function flakyProbe(result: unknown): () => Promise<unknown> {
  return () => Promise.resolve(result);
}

beforeEach(() => {
  resetNeonFailureStreakForTests();
});

describe("checkNeonWith — in-process failure streak fallback (no Redis)", () => {
  it("a single failure reports degraded (not yet failing)", async () => {
    const result = await checkNeonWith(failingProbe);
    expect(result.status).toBe("degraded");
    expect(result.error).toContain("connection terminated");
  });

  it("two consecutive failures escalate to failing → 503 on summary", async () => {
    // Test env has no Redis singleton initialized → the fallback path.
    const first = await checkNeonWith(failingProbe);
    const second = await checkNeonWith(failingProbe);
    expect(first.status).toBe("degraded");
    expect(second.status).toBe("failing");
  });

  it("a success resets the streak — failures are CONSECUTIVE, not cumulative", async () => {
    await checkNeonWith(failingProbe); // streak = 1
    const recovered = await checkNeonWith(flakyProbe({ rows: [{ "?column?": 1 }] }));
    expect(recovered.status).toBe("ok"); // streak reset
    const first = await checkNeonWith(failingProbe); // streak = 1 again
    expect(first.status).toBe("degraded");
    const second = await checkNeonWith(failingProbe); // streak = 2 → failing
    expect(second.status).toBe("failing");
  });

  it("a probe returning a falsy result counts as a failure (not a hang)", async () => {
    const first = await checkNeonWith(flakyProbe(null));
    const second = await checkNeonWith(flakyProbe(null));
    expect(first.status).toBe("degraded");
    expect(second.status).toBe("failing");
    expect(second.error).toBe("Query returned no result");
  });
});
