import { afterEach, beforeEach, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";

/**
 * Round-93 C3 (A3 audit R3) — /healthz/summary permanent wedge.
 *
 * The old computeReadyState had two compounding bugs during a Redis
 * outage (commands queued forever on a dead socket):
 *   1. checkRedis's catch path AWAITED `incrementFailureCounter` → a
 *      queued INCR that never settles → the check never returned;
 *   2. the shared `inflight` promise was only cleared in a `finally`
 *      that runs after the await settles → never. Every subsequent
 *      /healthz/summary request returned the SAME dead promise and hung
 *      forever (public status page included).
 *
 * These tests pin the fix: every Redis op inside the aggregate is
 * bounded, the aggregate itself is bounded by an absolute race, the
 * timeout snapshot is NOT cached, and `inflight` is reset in ALL settle
 * paths so follow-up requests recompute instead of inheriting the wedge.
 *
 * The health module is imported ONCE (pglite boot is expensive) — per-test
 * isolation comes from resetReadyStateForTests() + the lazy env-read
 * timeouts (HEALTH_CHECK_TIMEOUT_MS / HEALTH_AGGREGATE_TIMEOUT_MS).
 */

vi.mock("../../lib/redis-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/redis-client")>();
  return { ...actual, getRedisClient: vi.fn() };
});

// health.ts's import graph (lib/socket → lib/jwt) fail-fasts without
// SESSION_SECRET; lib/encryption needs ENCRYPTION_KEY. Throwaway values,
// same pattern as csrf-gate.test.ts.
process.env.SESSION_SECRET ??= "c3-health-wedge-test-session-secret-0123456789abcdef";
process.env.ENCRYPTION_KEY ??= "22".repeat(32);

import { getRedisClient } from "../../lib/redis-client";

let healthModule: typeof import("../health");

beforeAll(async () => {
  // Dynamic import so the env assignments above run BEFORE the health
  // module's import graph (lib/jwt fail-fasts without SESSION_SECRET).
  healthModule = await import("../health");
}, 30_000);

const ENV_KEYS = [
  "REDIS_URL",
  "HEALTH_CHECK_TIMEOUT_MS",
  "HEALTH_AGGREGATE_TIMEOUT_MS",
  "RISK_PIPELINE_ENABLED",
] as const;

const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  process.env.REDIS_URL = "redis://127.0.0.1:6399";
  healthModule?.resetReadyStateForTests();
  vi.clearAllMocks();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

/** The exact R2 outage shape: a client whose every command queues forever. */
function makeHangingRedis() {
  const HANG = () => new Promise<never>(() => {});
  return {
    isReady: true,
    ping: vi.fn(HANG),
    get: vi.fn(HANG),
    incr: vi.fn(HANG),
    expire: vi.fn(HANG),
    del: vi.fn(HANG),
  };
}

/**
 * Request /healthz/summary with a watchdog: if the route ever hangs (the
 * R3 wedge), the watchdog rejects.
 */
async function requestSummary(): Promise<{ status: number; body: string }> {
  const app = express();
  app.use(healthModule.default);
  return new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("no port"));
        return;
      }
      const watchdog = setTimeout(
        () => reject(new Error("/healthz/summary hung (R3 wedge regression)")),
        5_000,
      );
      try {
        const res = await fetch(`http://127.0.0.1:${addr.port}/healthz/summary`);
        clearTimeout(watchdog);
        resolve({ status: res.status, body: await res.text() });
      } catch (err) {
        clearTimeout(watchdog);
        reject(err);
      } finally {
        server.close();
      }
    });
  });
}

describe("R3 — /healthz/summary never wedges during a Redis outage", () => {
  it("responds with a bounded degraded snapshot while every Redis op hangs", async () => {
    vi.mocked(getRedisClient).mockReturnValue(makeHangingRedis() as never);
    // Ping hangs: the per-check race takes 500ms to fire...
    process.env.HEALTH_CHECK_TIMEOUT_MS = "500";
    // ...but the aggregate gives up at 60ms and answers degraded.
    process.env.HEALTH_AGGREGATE_TIMEOUT_MS = "60";

    const { status, body } = await requestSummary();

    expect(status).toBe(200);
    expect(JSON.parse(body)).toEqual({ status: "degraded" });
  });

  it("the in-flight promise is reset after a timeout — a SECOND request also responds (the actual wedge)", async () => {
    vi.mocked(getRedisClient).mockReturnValue(makeHangingRedis() as never);
    process.env.HEALTH_CHECK_TIMEOUT_MS = "500";
    process.env.HEALTH_AGGREGATE_TIMEOUT_MS = "60";

    // First request: aggregate times out → degraded snapshot, NOT cached.
    const first = await requestSummary();
    expect(first.status).toBe(200);
    expect(JSON.parse(first.body)).toEqual({ status: "degraded" });

    // Second request MUST recompute (inflight was reset in the timeout
    // path) and respond again. Under the old code this returned the dead
    // shared promise and hung forever.
    const second = await requestSummary();
    expect(second.status).toBe(200);
    expect(JSON.parse(second.body)).toEqual({ status: "degraded" });
  });

  it("a redis outage WITH REDIS_URL configured reports failing (503), not eternal degraded", async () => {
    // The outage shape where the singleton is simply GONE (getRedisClient
    // returns null): health must say "failing" so Render/operators see it.
    vi.mocked(getRedisClient).mockReturnValue(null);
    process.env.HEALTH_AGGREGATE_TIMEOUT_MS = "5000";

    const { status, body } = await requestSummary();

    // 503 with failing status (neon is healthy on the pglite harness; redis
    // failing is the only critical red).
    expect(status).toBe(503);
    expect(JSON.parse(body)).toEqual({ status: "failing" });
  });

  it("concurrent requests de-dup onto the bounded promise instead of hanging", async () => {
    vi.mocked(getRedisClient).mockReturnValue(makeHangingRedis() as never);
    process.env.HEALTH_CHECK_TIMEOUT_MS = "400";
    process.env.HEALTH_AGGREGATE_TIMEOUT_MS = "80";

    const app = express();
    app.use(healthModule.default);

    const fire = () =>
      new Promise<{ status: number; body: string }>((resolve, reject) => {
        const server = app.listen(0, async () => {
          const addr = server.address();
          if (!addr || typeof addr === "string") {
            reject(new Error("no port"));
            return;
          }
          const watchdog = setTimeout(
            () => reject(new Error("concurrent /healthz/summary hung (R3)")),
            5_000,
          );
          try {
            const res = await fetch(`http://127.0.0.1:${addr.port}/healthz/summary`);
            clearTimeout(watchdog);
            resolve({ status: res.status, body: await res.text() });
          } catch (err) {
            clearTimeout(watchdog);
            reject(err);
          } finally {
            server.close();
          }
        });
      });

    const both = await Promise.all([fire(), fire()]);
    for (const res of both) {
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ status: "degraded" });
    }
  });
});

describe("R3 — liveness endpoint stays trivially green (unchanged contract)", () => {
  it("/healthz/live answers 200 with no I/O even during a full outage", async () => {
    vi.mocked(getRedisClient).mockReturnValue(makeHangingRedis() as never);
    process.env.HEALTH_AGGREGATE_TIMEOUT_MS = "60";

    const app = express();
    app.use(healthModule.default);

    const res = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const server = app.listen(0, async () => {
        const addr = server.address();
        if (!addr || typeof addr === "string") {
          reject(new Error("no port"));
          return;
        }
        try {
          const r = await fetch(`http://127.0.0.1:${addr.port}/healthz/live`);
          resolve({ status: r.status, body: await r.text() });
        } catch (err) {
          reject(err);
        } finally {
          server.close();
        }
      });
    });

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: "ok" });
  });
});
