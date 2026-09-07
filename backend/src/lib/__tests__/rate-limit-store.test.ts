import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { rateLimit } from "express-rate-limit";

/**
 * Round-93 C3 (A3 audit R2) — resilient rate-limit store.
 *
 * The old wiring passed `rate-limit-redis` a raw `sendCommand` bound to
 * the singleton. During a runtime Redis outage node-redis queues the
 * commands (offline queue) — the awaited `increment()` never settled, so
 * EVERY /api request hung inside the limiter while /healthz stayed green
 * (silent full-site outage).
 *
 * These tests pin the new contract:
 *   - a never-settling sendCommand still yields a usable increment()
 *     result (memory fallback) within the command timeout;
 *   - no ready client at all → memory fallback immediately (no race wait);
 *   - an express-rate-limit middleware built on the store still calls
 *     next() (request completes) when every Redis op hangs;
 *   - after one Redis failure a cooldown skips Redis for follow-up ops.
 */

vi.mock("../../lib/redis-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/redis-client")>();
  return { ...actual, getRedisClient: vi.fn() };
});

import { getRedisClient, RedisCommandTimeoutError } from "../../lib/redis-client";
import { createResilientRateLimitStore } from "../rate-limit-store";

const ENV_KEYS = ["REDIS_COMMAND_TIMEOUT_MS"] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  process.env.REDIS_COMMAND_TIMEOUT_MS = "30";
  vi.clearAllMocks();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

/** A ready-but-dead client: isReady true, every command hangs (R2 gray zone). */
function makeHangingClient() {
  return {
    isReady: true,
    sendCommand: vi.fn(() => new Promise<never>(() => {})),
  };
}

describe("createResilientRateLimitStore — command timeout fallback (R2)", () => {
  it("increment() resolves from the memory fallback when sendCommand hangs", async () => {
    vi.mocked(getRedisClient).mockReturnValue(makeHangingClient() as never);
    const store = createResilientRateLimitStore();
    store.init?.({ windowMs: 60_000 } as never);

    const started = Date.now();
    const result = await store.increment("k1");
    expect(Date.now() - started).toBeLessThan(2_000);

    expect(result.totalHits).toBe(1);
    expect(result.resetTime).toBeInstanceOf(Date);
    // A second hit in the same window keeps counting (memory fallback
    // behaves like the normal memory store).
    const second = await store.increment("k1");
    expect(second.totalHits).toBe(2);
  });

  it("memory fallback is immediate when no ready client exists (no timeout penalty)", async () => {
    vi.mocked(getRedisClient).mockReturnValue(null);
    const store = createResilientRateLimitStore();
    store.init?.({ windowMs: 60_000 } as never);

    const started = Date.now();
    const result = await store.increment("k2");
    expect(Date.now() - started).toBeLessThan(100);
    expect(result.totalHits).toBe(1);
  });

  it("decrement() and resetKey() also fall back instead of hanging", async () => {
    vi.mocked(getRedisClient).mockReturnValue(makeHangingClient() as never);
    const store = createResilientRateLimitStore();
    store.init?.({ windowMs: 60_000 } as never);

    await store.increment("k3");
    const started = Date.now();
    await store.decrement("k3");
    await store.resetKey("k3");
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("cooldown: after a failed Redis op the store skips Redis until the cooldown lapses", async () => {
    const client = makeHangingClient();
    vi.mocked(getRedisClient).mockReturnValue(client as never);
    const store = createResilientRateLimitStore();
    store.init?.({ windowMs: 60_000 } as never);

    // First op: tries Redis, times out (30ms), falls back.
    await store.increment("k4");
    const callsAfterFirst = client.sendCommand.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    // Immediately following ops: cooldown active — no NEW redis commands
    // are issued (each would cost the full command-timeout race).
    await store.increment("k4");
    await store.increment("k4");
    expect(client.sendCommand.mock.calls.length).toBe(callsAfterFirst);
  });

  it("Redis timeouts surface as RedisCommandTimeoutError to the store (fast rejection)", async () => {
    const { withRedisCommandTimeout } = await import("../../lib/redis-client");
    await expect(
      withRedisCommandTimeout("rl_test", () => new Promise<never>(() => {}), 30),
    ).rejects.toBeInstanceOf(RedisCommandTimeoutError);
  });
});

describe("createResilientRateLimitStore — express-rate-limit integration (R2)", () => {
  function buildApp(store: ReturnType<typeof createResilientRateLimitStore>) {
    const app = express();
    const limiter = rateLimit({
      windowMs: 60 * 1000,
      limit: 600,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      store,
    });
    app.use(limiter);
    app.get("/ping", (_req, res) => res.status(200).json({ ok: true }));
    return app;
  }

  async function getOnce(app: express.Express): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const server = app.listen(0, async () => {
        const addr = server.address();
        if (!addr || typeof addr === "string") {
          reject(new Error("no port"));
          return;
        }
        try {
          const res = await fetch(`http://127.0.0.1:${addr.port}/ping`);
          resolve({ status: res.status, body: await res.text() });
        } catch (err) {
          reject(err);
        } finally {
          server.close();
        }
      });
    });
  }

  it("a request COMPLETES (200 + next() reached) while every Redis op hangs", async () => {
    vi.mocked(getRedisClient).mockReturnValue(makeHangingClient() as never);
    const app = buildApp(createResilientRateLimitStore());

    // Watchdog: if the limiter ever hangs the request (the old R2 bug),
    // the fetch never settles and this rejects after 5s.
    const watchdog = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("request hung in the rate limiter (R2 regression)")),
        5_000,
      ),
    );
    const { status, body } = await Promise.race([getOnce(app), watchdog]);
    expect(status).toBe(200);
    expect(JSON.parse(body)).toEqual({ ok: true });
  });
});
