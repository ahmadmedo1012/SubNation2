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
