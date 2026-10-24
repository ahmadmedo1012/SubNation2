import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * I-F1 (R186-3) — Socket.IO Redis adapter clients get 'error' listeners
 * BEFORE connect().
 *
 * node-redis's reconnect loop reports failures as 'error' EVENTS (not
 * promise rejections), and an EventEmitter emitting 'error' with ZERO
 * listeners THROWS — with REDIS_URL set and Redis down, the adapter path
 * in lib/socket.ts used to create pub/sub clients with no pre-connect
 * error listener, so the first reconnect tick crashed the process
 * (instrument.ts exits on uncaught exceptions), contradicting the
 * singleton's H12 stay-up posture.
 *
 * The fake clients below are REAL EventEmitters whose connect() emits
 * 'error' synchronously before settling — reproducing the no-listener-yet
 * window: without the fix the emit throws straight out of initSocket().
 * The `redis` package is mocked at the client level (the
 * redis-client-resilience.test.ts approach — a real down host would make
 * the suite depend on network conditions).
 */

const { warn, logError, info } = vi.hoisted(() => ({
  warn: vi.fn(),
  logError: vi.fn(),
  info: vi.fn(),
}));

vi.mock("redis", () => ({
  createClient: vi.fn(),
}));

vi.mock("../logger", () => ({
  logger: {
    warn,
    error: logError,
    info,
    debug: vi.fn(),
    child: vi.fn(() => ({ warn, error: logError, info })),
  },
}));

import { initSocket } from "../socket";

interface FakeAdapterClient extends EventEmitter {
  connect: ReturnType<typeof vi.fn>;
  duplicate: ReturnType<typeof vi.fn>;
}

/** duplicate() results — initSocket creates the sub client via
 * pubClient.duplicate(), so the twin handle is captured here. */
const twins: FakeAdapterClient[] = [];

function makeFakeAdapterClient(): FakeAdapterClient {
  const client = new EventEmitter() as FakeAdapterClient;
  client.connect = vi.fn((): Promise<never> => {
    // WHY emit-before-settle: the reconnect loop emits 'error' EVENTS, not
    // rejections — an EventEmitter with zero 'error' listeners throws at
    // the emit site. Emitting synchronously BEFORE the returned promise
    // settles reproduces exactly that hazard.
    client.emit("error", new Error("ECONNREFUSED — Redis down (reconnect loop)"));
    return Promise.reject(new Error("connect ECONNREFUSED"));
  });
  client.duplicate = vi.fn((): FakeAdapterClient => {
    const twin = makeFakeAdapterClient();
    twins.push(twin);
    return twin;
  });
  return client;
}

const ENV_KEYS = ["REDIS_URL"] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  // clearMocks is pinned false repo-wide (R180) — reset call history here.
  warn.mockClear();
  logError.mockClear();
  info.mockClear();
  twins.length = 0;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe("initSocket — Redis adapter clients get 'error' listeners BEFORE connect() (I-F1)", () => {
  it("absorbs a synchronously-emitted reconnect-loop 'error' (no throw, no uncaughtException)", async () => {
    process.env.REDIS_URL = "redis://127.0.0.1:6399";
    const uncaught = vi.fn();
    process.on("uncaughtException", uncaught);

    const pubClient = makeFakeAdapterClient();
    const redisModule = await import("redis");
    vi.mocked(redisModule.createClient).mockReturnValue(pubClient as never);

    const httpServer = createServer();
    // Without the fix, the emit inside connect() throws synchronously out
    // of THIS call (zero 'error' listeners on the adapter clients).
    const io = initSocket(httpServer);
    await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));

    try {
      // Pre-adapter state (connect() rejected → the adapter never installs):
      // BOTH adapter clients must already carry the stay-up warn listeners.
      expect(pubClient.listenerCount("error")).toBeGreaterThan(0);
      expect(twins).toHaveLength(1);
      expect(twins[0]!.listenerCount("error")).toBeGreaterThan(0);

      // The emitted errors were absorbed as warns (pub + sub) — not crashes.
      expect(warn).toHaveBeenCalledTimes(2);

      // The settled rejection rides the existing .catch: one error log,
      // never a crash.
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(logError).toHaveBeenCalledWith(expect.anything(), "Redis adapter connection failed");
      expect(uncaught).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve) => io.close(() => resolve()));
      process.off("uncaughtException", uncaught);
    }
  });
});
