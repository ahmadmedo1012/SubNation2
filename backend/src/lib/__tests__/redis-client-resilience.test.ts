import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Round-93 C3 (A3 audit R1/R2) — Redis singleton resilience.
 *
 * R1: with a numeric-only reconnectStrategy, node-redis 5's `connect()`
 * NEVER settles when Redis is unreachable (live-verified by A3 against
 * redis@5.12.1). The old `initRedisClient()` awaited it forever →
 * server.ts bootstrap never resolved → every route 503 "starting"
 * forever, and the "degraded mode" catch branch was unreachable dead
 * code. These tests pin the new contract:
 *   - boot resolves (null = degraded) within REDIS_CONNECT_TIMEOUT_MS;
 *   - the client object survives and, once "ready", the singleton hands
 *     it back out (self-healing, no restart).
 *
 * R2: `getRedisClient()` must only return a READY client — callers with
 * null-fallbacks then degrade instead of queueing commands into the
 * offline queue (hang).
 *
 * The `redis` package is mocked at the client level (A3's recommended
 * approach — reproducing an unreachable host with real sockets would make
 * the suite depend on network conditions).
 */

vi.mock("redis", () => ({
  createClient: vi.fn(),
}));

interface FakeClientOptions {
  connect?: () => Promise<unknown>;
  isReady?: boolean;
}

interface FakeClient {
  isReady: boolean;
  connect: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  ping: ReturnType<typeof vi.fn>;
  sendCommand: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  setEx: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
  incr: ReturnType<typeof vi.fn>;
  expire: ReturnType<typeof vi.fn>;
  emit: (event: string, ...args: unknown[]) => void;
}

const HANG = (): Promise<never> => new Promise(() => {});

function makeFakeClient(options: FakeClientOptions = {}): FakeClient {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const client: FakeClient = {
    isReady: options.isReady ?? false,
    connect: vi.fn(options.connect ?? HANG),
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      const list = listeners.get(event) ?? [];
      list.push(cb);
      listeners.set(event, list);
      return client;
    }),
    ping: vi.fn(() => Promise.resolve("PONG")),
    sendCommand: vi.fn(HANG),
    get: vi.fn(HANG),
    set: vi.fn(HANG),
    setEx: vi.fn(HANG),
    del: vi.fn(HANG),
    incr: vi.fn(HANG),
    expire: vi.fn(HANG),
    emit: (event: string, ...args: unknown[]) => {
      for (const cb of listeners.get(event) ?? []) cb(...args);
    },
  };
  return client;
}

const ENV_KEYS = ["REDIS_URL", "REDIS_CONNECT_TIMEOUT_MS", "REDIS_COMMAND_TIMEOUT_MS"] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  vi.resetModules();
  // The vi.mock("redis") factory instance survives resetModules — clear its
  // call history so "not.toHaveBeenCalled" assertions are per-test.
  vi.clearAllMocks();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  vi.restoreAllMocks();
});

async function loadModuleWithClient(client: FakeClient) {
  const redisModule = await import("redis");
  vi.mocked(redisModule.createClient).mockReturnValue(client as never);
  return import("../redis-client");
}

describe("R1 — boot settles within REDIS_CONNECT_TIMEOUT_MS (degraded, never hangs)", () => {
  it("resolves null (degraded) when connect() never settles", async () => {
    process.env.REDIS_URL = "redis://10.255.255.1:6379";
    process.env.REDIS_CONNECT_TIMEOUT_MS = "50";
    const client = makeFakeClient({ connect: HANG });

    const mod = await loadModuleWithClient(client);
    const started = Date.now();
    const result = await mod.initRedisClient();

    expect(Date.now() - started).toBeLessThan(2_000);
    expect(result).toBeNull();
    // The boot is CONSIDERED settled (server.ts proceeds) even though Redis
    // never answered — the whole point of R1.
    expect(mod.isRedisInitialised()).toBe(true);
  });

  it("does not hand out the not-ready client after a degraded boot (R2)", async () => {
    process.env.REDIS_URL = "redis://10.255.255.1:6379";
    process.env.REDIS_CONNECT_TIMEOUT_MS = "50";
    const client = makeFakeClient({ connect: HANG });

    const mod = await loadModuleWithClient(client);
    await mod.initRedisClient();

    expect(mod.getRedisClient()).toBeNull();
    expect(mod.isRedisConnected()).toBe(false);
  });

  it("recovers automatically when the socket becomes ready later (no restart)", async () => {
    process.env.REDIS_URL = "redis://10.255.255.1:6379";
    process.env.REDIS_CONNECT_TIMEOUT_MS = "50";
    const client = makeFakeClient({ connect: HANG });

    const mod = await loadModuleWithClient(client);
    await mod.initRedisClient();
    expect(mod.getRedisClient()).toBeNull();

    // The retained client finally connects (reconnectStrategy keeps
    // retrying in the background) — node-redis flips isReady and fires
    // the "ready" event.
    client.isReady = true;
    client.emit("ready");

    expect(mod.getRedisClient()).toBe(client as never);
    expect(mod.isRedisConnected()).toBe(true);
  });

  it("returns the client when connect() resolves within the budget", async () => {
    process.env.REDIS_URL = "redis://127.0.0.1:6399";
    const client = makeFakeClient({
      connect: () => Promise.resolve(client),
      isReady: true,
    });

    const mod = await loadModuleWithClient(client);
    const result = await mod.initRedisClient();

    expect(result).toBe(client as never);
    expect(mod.getRedisClient()).toBe(client as never);
    expect(mod.isRedisConnected()).toBe(true);
  });
});

describe("R1 — no REDIS_URL (existing dev/prod single-tier mode stays intact)", () => {
  it("resolves null immediately without touching createClient", async () => {
    const redisModule = await import("redis");
    const mod = await import("../redis-client");

    const result = await mod.initRedisClient();
    expect(result).toBeNull();
    expect(redisModule.createClient).not.toHaveBeenCalled();
    expect(mod.isRedisInitialised()).toBe(true);
    expect(mod.getRedisClient()).toBeNull();
  });
});

describe("R2 — withRedisCommandTimeout converts hangs into fast rejections", () => {
  it("rejects with RedisCommandTimeoutError when the command never settles", async () => {
    process.env.REDIS_COMMAND_TIMEOUT_MS = "40";
    const mod = await import("../redis-client");

    const started = Date.now();
    await expect(
      mod.withRedisCommandTimeout("test_hang", () => new Promise<never>(() => {})),
    ).rejects.toBeInstanceOf(mod.RedisCommandTimeoutError);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("passes successful commands through untouched", async () => {
    const mod = await import("../redis-client");
    const value = await mod.withRedisCommandTimeout("test_ok", () =>
      Promise.resolve("PONG" as const),
    );
    expect(value).toBe("PONG");
  });

  it("propagates genuine command rejections unchanged", async () => {
    const mod = await import("../redis-client");
    const boom = new Error("ECONNREFUSED");
    await expect(mod.withRedisCommandTimeout("test_err", () => Promise.reject(boom))).rejects.toBe(
      boom,
    );
  });
});
