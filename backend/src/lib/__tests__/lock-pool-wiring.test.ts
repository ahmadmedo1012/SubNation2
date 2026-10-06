import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * R118-A5 TOP-20 #5 [P2] — lockPool wiring (A5 W-2).
 *
 * The OTP start-lock suite (whatsapp-otp-start-lock.test.ts) injects a
 * FAKE pool via __setOtpStartLockPoolForTests — excellent for gate
 * behavior, but nothing pins that production resolves @workspace/db's
 * DEDICATED lockPool. Re-pointing the gate at the runtime pool (or
 * changing the pool's bounded sizing) would still pass every existing
 * test.
 *
 * Three layers of pinning:
 *   1. SOURCE-CONTRACT (precedent: no-native-confirm.test.ts) —
 *      shared/db/src/index.ts still creates lockPool with max: 2 +
 *      connectionTimeoutMillis: 2_000, and whatsapp-otp.service.ts's
 *      resolver reads `mod.lockPool` (never `mod.pool`);
 *   2. RUNTIME — the REAL shared/db module (not the pglite alias, same
 *      trick as db-statement-timeout.test.ts) exports a lockPool that is
 *      a DISTINCT object from the runtime pool, with the bounded options;
 *   3. OVERRIDE — the lock pool's bounds win over the env-driven runtime
 *      pool config (DB_POOL_MAX / DB_CONNECTION_TIMEOUT_MS).
 *
 * pg.Pool construction is lazy (no connection opened), so importing the
 * real module with a dummy DATABASE_URL is safe.
 */

const DB_INDEX_PATH = resolve(process.cwd(), "..", "shared", "db", "src", "index.ts");
const OTP_SERVICE_PATH = resolve(process.cwd(), "src", "services", "whatsapp-otp.service.ts");

const ENV_KEYS = ["DATABASE_URL", "DB_POOL_MAX", "DB_CONNECTION_TIMEOUT_MS"] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/lockpool_test";
  // Runtime-pool shaping the lockPool override must WIN over.
  process.env.DB_POOL_MAX = "8";
  process.env.DB_CONNECTION_TIMEOUT_MS = "10000";
  vi.resetModules();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

async function loadRealDbModule() {
  return import("../../../../shared/db/src/index.ts");
}

describe("lockPool wiring (R118-A5 #5 / W-2)", () => {
  describe("source contract — shared/db/src/index.ts", () => {
    it("creates a dedicated lockPool with max: 2 and connectionTimeoutMillis: 2_000", () => {
      const text = readFileSync(DB_INDEX_PATH, "utf8");
      // The dedicated pool block: spreads the runtime config but OVERRIDES
      // both bounds (R117 A1-P2 — holders span ~30 s WhatsApp sends; the
      // 2 s connect timeout fails excess callers fast into the retry path).
      expect(text).toMatch(
        /export const lockPool = new Pool\(\{\s*\.\.\.poolConfig,\s*max: 2,\s*connectionTimeoutMillis: 2_000,\s*\}\);/,
      );
    });

    it("exports dbPoolConfig for unit tests (the R4 seam this suite rides on)", () => {
      const text = readFileSync(DB_INDEX_PATH, "utf8");
      expect(text).toMatch(/export \{ poolConfig as dbPoolConfig \}/);
    });

    it("attaches the lockPool error handler so an idle-client kill cannot crash the process", () => {
      const text = readFileSync(DB_INDEX_PATH, "utf8");
      expect(text).toMatch(/lockPool\.on\("error"/);
    });
  });

  describe("source contract — services/whatsapp-otp.service.ts", () => {
    it("the resolver reads mod.lockPool from @workspace/db (never the runtime pool)", () => {
      const text = readFileSync(OTP_SERVICE_PATH, "utf8");
      expect(text).toMatch(/mod\.lockPool/);
      expect(text).not.toMatch(/\bmod\.pool\b/);
      expect(text).toMatch(/import\("@workspace\/db"\)/);
    });

    it("the resolver only accepts an object with a connect function (fail-safe skip otherwise)", () => {
      const text = readFileSync(OTP_SERVICE_PATH, "utf8");
      expect(text).toMatch(
        /mod\.lockPool && typeof \(mod\.lockPool as PoolLike\)\.connect === "function"/,
      );
    });
  });

  describe("runtime — the real shared/db module", () => {
    it("lockPool is a DISTINCT pool from the runtime pool, bounded at max 2 / 2 s connect timeout", async () => {
      const mod = await loadRealDbModule();
      expect(mod.lockPool).toBeDefined();
      expect(mod.pool).toBeDefined();
      // Distinct objects — re-pointing the export at the runtime pool
      // (or vice versa) fails here even if every source regex survived.
      expect(mod.lockPool).not.toBe(mod.pool);

      const lockOpts = mod.lockPool.options as { max?: number; connectionTimeoutMillis?: number };
      expect(lockOpts.max).toBe(2);
      expect(lockOpts.connectionTimeoutMillis).toBe(2_000);
    });

    it("the lock pool bounds OVERRIDE the env-driven runtime pool config", async () => {
      const mod = await loadRealDbModule();
      // The runtime pool honours DB_POOL_MAX=8 / DB_CONNECTION_TIMEOUT_MS=10000…
      const poolOpts = mod.pool.options as { max?: number; connectionTimeoutMillis?: number };
      expect(poolOpts.max).toBe(8);
      expect(poolOpts.connectionTimeoutMillis).toBe(10_000);
      expect(mod.dbPoolConfig.max).toBe(8);
      // …while the lock pool keeps its own bounded shape regardless.
      const lockOpts = mod.lockPool.options as { max?: number; connectionTimeoutMillis?: number };
      expect(lockOpts.max).toBe(2);
      expect(lockOpts.connectionTimeoutMillis).toBe(2_000);
    });
  });
});
