import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * R187 (G-F3) — the risk-config pub/sub duplicate's lifecycle.
 *
 * The audit's three legs against ensureInvalidationSubscription:
 *   (a) `invalidationSubscribed` flipped only AFTER the awaits, so two
 *       concurrent first getRiskConfig calls each minted a duplicate
 *       connection (and each ran connect + subscribe);
 *   (b) `sub.subscribe` was the last unbounded op on the path — a
 *       gray-zone socket queued it forever and getRiskConfig hung after
 *       the DB read had already succeeded;
 *   (c) the duplicate had no close path — the drain's closeRedisClient()
 *       quits the singleton only, so the dedicated connection outlived
 *       the orderly exit.
 *
 * Fixes under test: a module-level shared first-attempt promise (one
 * duplicate, however many concurrent first callers), the subscribe wrapped
 * in withRedisCommandTimeout with the loser retired, and the exported
 * closeRiskConfigSubscription() the server drain now calls beside
 * closeRedisClient().
 *
 * Harness: the risk-redis-bounded idiom (vi.mock keeps the REAL
 * withRedisCommandTimeout via importOriginal; getRedisClient returns a
 * controllable fake) + a fresh module graph per case (the
 * alerting-reliability idiom) so every leg starts from virgin subscription
 * state; each case provisions its own pglite + risk_config table.
 */

const { redisState } = vi.hoisted(() => ({ redisState: { client: null as unknown } }));

vi.mock("../../lib/redis-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/redis-client")>();
  return { ...actual, getRedisClient: () => redisState.client };
});

const RISK_CONFIG_DDL = `CREATE TABLE IF NOT EXISTS risk_config (
  id integer PRIMARY KEY DEFAULT 1,
  thresholds jsonb NOT NULL,
  allowlist jsonb NOT NULL,
  auto_block_enabled jsonb NOT NULL,
  require_approval_user_ids jsonb NOT NULL DEFAULT '[]',
  model_enabled boolean NOT NULL DEFAULT false,
  updated_by integer,
  updated_at timestamptz NOT NULL DEFAULT now()
)`;

interface FakeSub {
  on: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  quit: ReturnType<typeof vi.fn>;
}

/** The pub/sub duplicate. `subscribeHangs` = the gray-zone socket class. */
function makeSub(opts: { subscribeHangs?: boolean } = {}): FakeSub {
  return {
    on: vi.fn(() => ({})),
    connect: vi.fn(async () => undefined),
    subscribe: opts.subscribeHangs
      ? vi.fn(() => new Promise<never>(() => {}))
      : vi.fn(async () => 1),
    disconnect: vi.fn(() => {}),
    quit: vi.fn(async () => "OK"),
  };
}

/** The MAIN singleton client — redis read-through misses so the DB path runs. */
function makeMainClient(subFactory: () => FakeSub) {
  const created: FakeSub[] = [];
  const client = {
    get: vi.fn(async () => null),
    set: vi.fn(async () => "OK"),
    del: vi.fn(async () => 1),
    publish: vi.fn(async () => 1),
    duplicate: vi.fn(() => {
      const sub = subFactory();
      created.push(sub);
      return sub;
    }),
  };
  return { client, created };
}

/** Fresh service + harness modules per case (vi.resetModules in beforeEach). */
async function importFresh() {
  const service = await import("../risk-config-cache.service");
  const harness = await import("../../test/db");
  await harness.initTestDb();
  await harness.execTestSql(RISK_CONFIG_DDL);
  return { service, db: harness.db };
}

const SAVED_TIMEOUT_MS = process.env.REDIS_COMMAND_TIMEOUT_MS;

beforeEach(() => {
  vi.resetModules();
  redisState.client = null;
  // Keep the black-holed subscribe cheap: 50 ms per bounded op.
  process.env.REDIS_COMMAND_TIMEOUT_MS = "50";
});

afterAll(() => {
  if (SAVED_TIMEOUT_MS === undefined) delete process.env.REDIS_COMMAND_TIMEOUT_MS;
  else process.env.REDIS_COMMAND_TIMEOUT_MS = SAVED_TIMEOUT_MS;
});

describe("R187 (G-F3) — risk-config pub/sub duplicate lifecycle", () => {
  it(
    "concurrent first callers share ONE attempt — duplicate() called once, subscribe once",
    { timeout: 20_000 },
    async () => {
      const { client, created } = makeMainClient(() => makeSub());
      redisState.client = client;
      const { service } = await importFresh();

      const [a, b] = await Promise.all([service.getRiskConfig(), service.getRiskConfig()]);

      // Both callers got the auto-seeded defaults (the DB path ran).
      expect(a).toMatchObject({
        modelEnabled: false,
        thresholds: { low: 0, medium: 30, high: 60, critical: 85 },
      });
      expect(b).toEqual(a);

      // THE race fix: the old post-await flag minted one duplicate PER caller.
      expect(client.duplicate).toHaveBeenCalledTimes(1);
      expect(created[0]!.subscribe).toHaveBeenCalledTimes(1);
    },
  );

  it(
    "a never-settling subscribe still resolves getRiskConfig via the DB path (bounded + loser retired)",
    { timeout: 15_000 },
    async () => {
      const { client, created } = makeMainClient(() => makeSub({ subscribeHangs: true }));
      redisState.client = client;
      const { service } = await importFresh();

      // Pre-fix this await never settled (the unbounded sub.subscribe).
      const snap = await service.getRiskConfig();

      expect(snap).toMatchObject({
        modelEnabled: false,
        thresholds: { low: 0, medium: 30, high: 60, critical: 85 },
      });
      // The timed-out duplicate was retired — zero orphan connections.
      expect(client.duplicate).toHaveBeenCalledTimes(1);
      expect(created[0]!.disconnect).toHaveBeenCalledTimes(1);
    },
  );

  it(
    "the drain closes the duplicate — closeRiskConfigSubscription quits it (bounded, resolves)",
    { timeout: 15_000 },
    async () => {
      const { client, created } = makeMainClient(() => makeSub());
      redisState.client = client;
      const { service } = await importFresh();

      await service.getRiskConfig(); // subscribes → the duplicate is live
      expect(client.duplicate).toHaveBeenCalledTimes(1);

      // What server.ts's drain now calls beside closeRedisClient().
      await expect(service.closeRiskConfigSubscription()).resolves.toBeUndefined();
      expect(created[0]!.quit).toHaveBeenCalledTimes(1);

      // Idempotent: a second close is a no-op (the drain + a racing signal).
      await expect(service.closeRiskConfigSubscription()).resolves.toBeUndefined();
      expect(created[0]!.quit).toHaveBeenCalledTimes(1);
    },
  );
});
