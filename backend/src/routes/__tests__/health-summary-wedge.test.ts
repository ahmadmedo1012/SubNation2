import { afterEach, beforeEach, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import { adminUsersTable, db, initTestDb } from "../../test/db";

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
 *
 * R110-E (109-k P2-1/P3-2): extended to pin the health-honesty contract
 * for the DESIGNED no-Redis single-instance shape — /healthz/summary must
 * read "ok" (worker/socket not-applicable, ok+note), the admin-gated
 * /healthz/{worker,socket} endpoints must answer 200 + note instead of
 * 503 "Redis not configured", and the Redis-CONFIGURED paths must keep
 * their real degraded/503 semantics (regression guards below).
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

/**
 * R110-E: sid-less admin token (requireAdmin accepts those outside
 * production as long as the admin_users row exists + is active — same
 * fixture shape as metrics-auth.test.ts). Needed because
 * /healthz/{worker,socket} are admin-gated.
 */
let adminToken: string;

beforeAll(async () => {
  // Dynamic import so the env assignments above run BEFORE the health
  // module's import graph (lib/jwt fail-fasts without SESSION_SECRET).
  healthModule = await import("../health");
  const { signAdminToken } = await import("../../lib/jwt");
  // The per-subsystem endpoints under test sit behind requireAdmin, which
  // does a live admin_users lookup — build the schema + seed one admin.
  await initTestDb();
  const [admin] = await db
    .insert(adminUsersTable)
    .values({ username: "health_admin", passwordHash: "x", isActive: true })
    .returning();
  adminToken = signAdminToken({ adminId: admin.id, role: "admin" });
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
 * R110-E regression-guard shape: a HEALTHY Redis (ping PONG) whose worker
 * heartbeat key holds a timestamp ~5 min old — past checkWorker's 180 s
 * "failing" threshold. With REDIS_URL configured this MUST stay a real
 * failure; only the no-Redis-designed shape is allowed to read ok.
 */
function makeStaleHeartbeatRedis() {
  return {
    isReady: true,
    ping: vi.fn().mockResolvedValue("PONG"),
    get: vi.fn().mockResolvedValue(JSON.stringify({ ts: Date.now() - 300_000 })),
    incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    del: vi.fn().mockResolvedValue(1),
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

/**
 * R110-E: request an arbitrary healthz route (optional headers) under the
 * same watchdog discipline as requestSummary — generalizes it for the
 * admin-gated per-subsystem endpoints.
 */
async function requestHealthz(
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string }> {
  const app = express();
  app.use(healthModule.default);
  return new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("no port"));
        return;
      }
      const watchdog = setTimeout(() => reject(new Error(`${path} hung`)), 5_000);
      try {
        const res = await fetch(`http://127.0.0.1:${addr.port}${path}`, { headers });
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

describe("R110-E — DESIGNED no-Redis single-instance shape reads as OK", () => {
  it("/healthz/summary reports ok — the public /status page is no longer permanently yellow", async () => {
    delete process.env.REDIS_URL;
    vi.mocked(getRedisClient).mockReturnValue(null);

    const { status, body } = await requestSummary();

    expect(status).toBe(200);
    expect(JSON.parse(body)).toEqual({ status: "ok" });
  });

  it("aggregate: worker + socket subsystems read ok with explanatory notes", async () => {
    delete process.env.REDIS_URL;
    vi.mocked(getRedisClient).mockReturnValue(null);

    const state = await healthModule.computeReadyState();

    expect(state.status).toBe("ok");
    // FH-A5 P2-3 (pre-existing): the redis branch already reads ok+note.
    expect(state.checks.redis?.status).toBe("ok");
    expect(state.checks.redis?.note).toMatch(/single-tier/);
    // R110-E: worker + socket are NOT APPLICABLE in this topology — the old
    // "degraded" fold here is what kept the summary permanently yellow.
    expect(state.checks.worker?.status).toBe("ok");
    expect(state.checks.worker?.optional).toBe(true);
    expect(state.checks.worker?.note).toMatch(/single-instance, no-Redis by design/);
    expect(state.checks.socket?.status).toBe("ok");
    expect(state.checks.socket?.optional).toBe(true);
    expect(state.checks.socket?.note).toMatch(/single-instance, no-Redis by design/);
  });

  it("/healthz/worker answers 200 + note instead of 503 'Redis not configured'", async () => {
    delete process.env.REDIS_URL;
    vi.mocked(getRedisClient).mockReturnValue(null);

    const res = await requestHealthz("/healthz/worker", {
      Authorization: `Bearer ${adminToken}`,
    });

    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed.status).toBe("ok");
    expect(parsed.optional).toBe(true);
    expect(parsed.note).toMatch(/single-instance, no-Redis by design/);
    expect(parsed.lastCheckedAt).toBeTruthy();
  });

  it("/healthz/socket answers 200 + note instead of 503 'Redis not configured'", async () => {
    delete process.env.REDIS_URL;
    vi.mocked(getRedisClient).mockReturnValue(null);

    const res = await requestHealthz("/healthz/socket", {
      Authorization: `Bearer ${adminToken}`,
    });

    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed.status).toBe("ok");
    expect(parsed.optional).toBe(true);
    expect(parsed.note).toMatch(/single-instance, no-Redis by design/);
    expect(parsed.lastCheckedAt).toBeTruthy();
  });

  it("admin gate unchanged: /healthz/worker without credentials still 401s", async () => {
    delete process.env.REDIS_URL;
    vi.mocked(getRedisClient).mockReturnValue(null);

    const res = await requestHealthz("/healthz/worker");

    expect(res.status).toBe(401);
  });
});

describe("R110-E — Redis-CONFIGURED regression guards (real checks stay real)", () => {
  it("REDIS_URL set + stale worker heartbeat → /healthz/worker 503 failing", async () => {
    // beforeEach pins REDIS_URL=redis://127.0.0.1:6399.
    vi.mocked(getRedisClient).mockReturnValue(makeStaleHeartbeatRedis() as never);

    const res = await requestHealthz("/healthz/worker", {
      Authorization: `Bearer ${adminToken}`,
    });

    expect(res.status).toBe(503);
    const parsed = JSON.parse(res.body);
    expect(parsed.status).toBe("failing");
    expect(parsed.error).toMatch(/Worker heartbeat too old/);
  });

  it("REDIS_URL set + client gone → /healthz/worker 503 'Redis configured but unavailable'", async () => {
    vi.mocked(getRedisClient).mockReturnValue(null);

    const res = await requestHealthz("/healthz/worker", {
      Authorization: `Bearer ${adminToken}`,
    });

    expect(res.status).toBe(503);
    expect(JSON.parse(res.body).error).toMatch(/Redis configured but unavailable/);
  });

  it("REDIS_URL set + stale worker heartbeat folds the aggregate off ok", async () => {
    vi.mocked(getRedisClient).mockReturnValue(makeStaleHeartbeatRedis() as never);

    const state = await healthModule.computeReadyState();

    expect(state.checks.worker?.status).toBe("failing");
    expect(state.status).not.toBe("ok");
  });

  it("REDIS_URL set + Socket.IO missing → /healthz/socket keeps 503 'Socket.IO not initialized'", async () => {
    vi.mocked(getRedisClient).mockReturnValue(null);

    const res = await requestHealthz("/healthz/socket", {
      Authorization: `Bearer ${adminToken}`,
    });

    expect(res.status).toBe(503);
    expect(JSON.parse(res.body).error).toBe("Socket.IO not initialized");
  });
});
