import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * B7-P1-6/P1-7 (round-92): the worker's SIGTERM path used to
 * `process.exit(0)` immediately (in-flight DB work cut, pool never
 * drained) and the worker exited(1) at boot when Redis was down
 * (crash-loop, contradicting the web tier's H12 policy).
 *
 * worker.ts exposes installWorkerSignalHandlers() with injectable
 * resources so the registration + drain order is testable without
 * spinning up Redis / a real DB pool. process.exit is stubbed via the
 * injected `exit` (never touching the real process.exit / the runner).
 */

vi.mock("../src/instrument", () => ({}));

import { installWorkerSignalHandlers } from "../src/worker";

describe("installWorkerSignalHandlers — graceful drain (B7-P1-6)", () => {
  let exitCalls: number[];
  let stopCalls: string[];
  let drainCalls: number[];
  let dispose: (() => void) | null;

  beforeEach(() => {
    exitCalls = [];
    stopCalls = [];
    drainCalls = [];
    dispose = null;
  });

  afterEach(() => {
    dispose?.();
  });

  function install(forceExitAfterMs = 1_000) {
    dispose = installWorkerSignalHandlers({
      stopSchedulers: () => {
        stopCalls.push("schedulers");
      },
      drain: async () => {
        drainCalls.push(1);
      },
      forceExitAfterMs,
      exit: (code: number) => {
        exitCalls.push(code);
        return undefined as never;
      },
    }).dispose;
    return dispose;
  }

  it("registers SIGTERM and SIGINT listeners (removable via dispose)", () => {
    const beforeTerm = process.listenerCount("SIGTERM");
    const beforeInt = process.listenerCount("SIGINT");
    install();
    expect(process.listenerCount("SIGTERM")).toBe(beforeTerm + 1);
    expect(process.listenerCount("SIGINT")).toBe(beforeInt + 1);
    dispose?.();
    expect(process.listenerCount("SIGTERM")).toBe(beforeTerm);
    expect(process.listenerCount("SIGINT")).toBe(beforeInt);
  });

  it("SIGTERM stops schedulers FIRST, drains, then exit(0)", async () => {
    install();
    process.emit("SIGTERM");
    await vi.waitFor(() => expect(exitCalls).toEqual([0]));
    expect(stopCalls).toEqual(["schedulers"]);
    expect(drainCalls).toHaveLength(1);
  });

  it("SIGINT takes the same graceful path", async () => {
    install();
    process.emit("SIGINT");
    await vi.waitFor(() => expect(exitCalls).toEqual([0]));
    expect(drainCalls).toHaveLength(1);
  });

  it("a second signal during shutdown is ignored (no double drain/exit)", async () => {
    install();
    process.emit("SIGTERM");
    process.emit("SIGTERM"); // while draining
    await vi.waitFor(() => expect(exitCalls).toEqual([0]));
    expect(stopCalls).toHaveLength(1);
    expect(drainCalls).toHaveLength(1);
  });

  it("force-exits with code 1 when drain exceeds the timeout", async () => {
    vi.useFakeTimers();
    try {
      // A drain that never resolves:
      dispose = installWorkerSignalHandlers({
        stopSchedulers: () => {},
        drain: () => new Promise<void>(() => {}),
        forceExitAfterMs: 10,
        exit: (code: number) => {
          exitCalls.push(code);
          return undefined as never;
        },
      }).dispose;
      process.emit("SIGTERM");
      await vi.advanceTimersByTimeAsync(20);
      expect(exitCalls).toEqual([1]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a drain error still exits cleanly with code 0", async () => {
    dispose = installWorkerSignalHandlers({
      stopSchedulers: () => {},
      drain: async () => {
        throw new Error("pool.end blew up");
      },
      forceExitAfterMs: 1_000,
      exit: (code: number) => {
        exitCalls.push(code);
        return undefined as never;
      },
    }).dispose;
    process.emit("SIGTERM");
    await vi.waitFor(() => expect(exitCalls).toEqual([0]));
  });
});
