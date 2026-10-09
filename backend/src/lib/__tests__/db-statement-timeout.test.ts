import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Round-93 C3 (A3 audit R4) — DB statement_timeout.
 *
 * Previously NOTHING bounded an individual query: pg's
 * connectionTimeoutMillis only covers POOL ACQUISITION, and a Neon
 * AZ/pooler stall with silent packet drops left each of the 15 pool
 * clients stuck mid-query forever — pool exhausted, every DB-touching
 * request hung, liveness stayed 200 ("green while dead"). pg transmits
 * `statement_timeout` as a per-connection STARTUP parameter, so every
 * pooled connection now gets a server-side deadline.
 *
 * The test imports the REAL shared/db module (NOT the pglite test alias
 * — that is only applied to the bare "@workspace/db" specifier) with a
 * dummy DATABASE_URL; pg.Pool construction is lazy (no connection is
 * opened), so asserting on the config handed to the pool is safe.
 */

const ENV_KEYS = ["DATABASE_URL", "PG_STATEMENT_TIMEOUT_MS"] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/subnation_test";
  vi.resetModules();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

async function loadDbModule() {
  return import("../../../../shared/db/src/index.ts");
}

describe("R4 — resolveStatementTimeoutMs", () => {
  it("defaults to 15s when the env var is missing", async () => {
    const mod = await loadDbModule();
    expect(mod.resolveStatementTimeoutMs(undefined)).toBe(15_000);
  });

  it("honours a positive override", async () => {
    const mod = await loadDbModule();
    expect(mod.resolveStatementTimeoutMs("25000")).toBe(25_000);
  });

  it("0 disables the timeout (operator escape hatch for long migrations)", async () => {
    const mod = await loadDbModule();
    expect(mod.resolveStatementTimeoutMs("0")).toBe(0);
  });

  it("garbage and negative values fall back to the 15s default", async () => {
    const mod = await loadDbModule();
    expect(mod.resolveStatementTimeoutMs("abc")).toBe(15_000);
    expect(mod.resolveStatementTimeoutMs("-5000")).toBe(15_000);
  });
});

describe("R4 — pool config carries statement_timeout + TCP keepalives", () => {
  it("statement_timeout defaults to 15000 and keepalives are on", async () => {
    const mod = await loadDbModule();
    expect(mod.dbPoolConfig.statement_timeout).toBe(15_000);
    expect(mod.dbPoolConfig.keepAlive).toBe(true);
    expect(mod.dbPoolConfig.keepAliveInitialDelayMillis).toBe(30_000);
  });

  it("PG_STATEMENT_TIMEOUT_MS=0 omits the server-side deadline (disabled)", async () => {
    process.env.PG_STATEMENT_TIMEOUT_MS = "0";
    const mod = await loadDbModule();
    expect(mod.dbPoolConfig.statement_timeout).toBeUndefined();
  });

  it("PG_STATEMENT_TIMEOUT_MS is honoured end-to-end in the pool config", async () => {
    process.env.PG_STATEMENT_TIMEOUT_MS = "60000";
    const mod = await loadDbModule();
    expect(mod.dbPoolConfig.statement_timeout).toBe(60_000);
  });
});

/**
 * R127-L3 (B8 F-P2) — the post-connect `SET statement_timeout` hook.
 *
 * B8 live-proved the startup-packet transport is a NO-OP on Neon (the
 * packet is sent — pg 8.20.0 getStartupConf carries it — but the server
 * session reports statement_timeout = 0 on both the pooler and direct
 * endpoints; only an explicit `SET` sticks through the pooler). The
 * fix: every new client of BOTH pools (runtime + lockPool) re-asserts
 * the deadline on "connect".
 *
 * pg.Pool construction stays lazy (no connection opened — see the R4
 * header), so the hook is exercised by emitting the pool's own
 * "connect" event with a spy client, the same event pg fires for every
 * real new connection.
 */
describe('R127 (B8 F-P2) — pool.on("connect") issues SET statement_timeout', () => {
  /** A spy stand-in for a freshly connected pg client. */
  function fakeClient() {
    return { query: vi.fn().mockResolvedValue(undefined) };
  }

  it("the runtime pool SETs the resolved timeout on every new client", async () => {
    const mod = await loadDbModule();
    const client = fakeClient();
    mod.pool.emit("connect", client);
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(client.query).toHaveBeenCalledWith("SET statement_timeout = 15000");
  });

  it("the lockPool carries the SAME hook (B8: lockPool inherits the inert startup config)", async () => {
    const mod = await loadDbModule();
    const client = fakeClient();
    mod.lockPool.emit("connect", client);
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(client.query).toHaveBeenCalledWith("SET statement_timeout = 15000");
  });

  it("PG_STATEMENT_TIMEOUT_MS override flows into the SET (60000)", async () => {
    process.env.PG_STATEMENT_TIMEOUT_MS = "60000";
    const mod = await loadDbModule();
    const client = fakeClient();
    mod.pool.emit("connect", client);
    expect(client.query).toHaveBeenCalledWith("SET statement_timeout = 60000");
  });

  it("PG_STATEMENT_TIMEOUT_MS=0 disables the hook entirely (no SET issued)", async () => {
    process.env.PG_STATEMENT_TIMEOUT_MS = "0";
    const mod = await loadDbModule();
    const client = fakeClient();
    mod.pool.emit("connect", client);
    expect(client.query).not.toHaveBeenCalled();
  });

  it("a rejected SET never propagates (the hook must not kill the connection path)", async () => {
    const mod = await loadDbModule();
    const client = { query: vi.fn().mockRejectedValue(new Error("proxy rejects SET")) };
    expect(() => mod.pool.emit("connect", client)).not.toThrow();
    // The .catch(() => {}) swallow means no unhandled rejection either —
    // if the hook regressed to a bare `void client.query(...)` without
    // the catch, vitest's unhandled-rejection surface would fail here.
    await new Promise((r) => setTimeout(r, 0));
  });
});
