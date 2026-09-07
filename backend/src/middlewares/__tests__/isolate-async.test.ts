import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "../../lib/logger";
import { monitoringErrorsTotal } from "../../lib/metrics";
import { isolate } from "../instrumentation-isolation";

/**
 * Round-93 C3 (A3 audit R7) — isolate() contract.
 *
 * The old implementation only caught SYNC throws — and re-threw them,
 * contradicting its own doc ("Never propagates errors to the caller").
 * For async functions (its only real usage: worker heartbeat writes) a
 * rejected promise bypassed the try/catch entirely: no counter, no log,
 * no Sentry — heartbeat failures were completely silent while callers'
 * `.catch(() => {})` comments claimed "error already logged".
 */

beforeEach(() => {
  vi.spyOn(monitoringErrorsTotal, "inc").mockImplementation(() => {});
  vi.spyOn(logger, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("R7 — isolate() honors its never-propagates contract for async functions", () => {
  it("resolves (undefined) instead of rejecting when the wrapped async fn rejects", async () => {
    const isolated = isolate("worker-heartbeat", async (): Promise<void> => {
      throw new Error("redis setEx failed");
    });

    const result = await isolated();
    expect(result).toBeUndefined();
  });

  it("reports async failures: counter + error log (the observability the docs promised)", async () => {
    const isolated = isolate("worker-heartbeat", async (): Promise<void> => {
      throw new Error("redis setex ECONNREFUSED");
    });
    await isolated();

    expect(monitoringErrorsTotal.inc).toHaveBeenCalledWith({ component: "worker-heartbeat" });
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it("passes successful async results through untouched", async () => {
    const isolated = isolate("worker-heartbeat", async () => 42);
    await expect(isolated()).resolves.toBe(42);
    expect(monitoringErrorsTotal.inc).not.toHaveBeenCalled();
  });

  it("keeps the caller alive: no unhandled rejection escapes the interval-callback shape", async () => {
    // The exact heartbeat usage shape: the isolated fn is invoked and its
    // (now always-settling) promise awaited by the caller's catch — under
    // the old code the rejection was invisible AND the promise still
    // rejected, so anything not literally .catch-ing it crashed.
    const failures: unknown[] = [];
    process.on("unhandledRejection", (err) => failures.push(err));
    try {
      const isolated = isolate("worker-heartbeat", async (): Promise<void> => {
        throw new Error("boom");
      });
      await isolated();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(failures).toHaveLength(0);
    } finally {
      process.removeAllListeners("unhandledRejection");
    }
  });
});

describe("R7 — isolate() contract for sync functions", () => {
  it("swallows sync throws instead of re-throwing them (doc said never-propagate)", () => {
    const isolated = isolate("sync-component", (): number => {
      throw new Error("sync boom");
    });

    expect(() => isolated()).not.toThrow();
    expect(monitoringErrorsTotal.inc).toHaveBeenCalledWith({ component: "sync-component" });
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it("passes successful sync results through", () => {
    const isolated = isolate("sync-component", (a: number, b: number): number => a + b);
    expect(isolated(2, 3)).toBe(5);
    expect(monitoringErrorsTotal.inc).not.toHaveBeenCalled();
  });
});
