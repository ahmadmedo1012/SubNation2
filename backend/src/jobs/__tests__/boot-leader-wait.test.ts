import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * F7 (round-94 A6) — waitForLeader budget + Redis-error semantics.
 *
 * The follower wait used to (a) give up after 60 s while the leader may
 * legitimately hold the 300 s lock (extended by refreshLockTtl through
 * the 5/15/45 s transient-retry schedule), and (b) treat ANY Redis error
 * as "the leader finished" — fail-open: the boot gate opened while the
 * leader was still mid-migration (serving traffic on a schema still being
 * reconciled — the exact contract server.ts forbids).
 *
 * Fix under test:
 *   - wait budget = LOCK_TTL_SEC (300 s; env-tunable for this test);
 *   - a Redis error keeps the loop WAITING (one warn, then silent
 *     retries) — the lock state is unknown, not "gone";
 *   - the client is re-resolved each iteration (getRedisClient), so a
 *     dropped-and-returned client is handled.
 *
 * Module graph mocked like boot-resilience.test.ts: runMigrations (DDL
 * body — must NEVER run on the follower), the Redis singleton, and
 * @workspace/db (writable probe).
 */

vi.mock("../../migrate", () => ({
  runMigrations: vi.fn(),
}));

const fakeRedis = {
  set: vi.fn(() => Promise.resolve(null)), // lock held by another instance
  exists: vi.fn(),
  eval: vi.fn(() => Promise.resolve(1)),
};

vi.mock("../../lib/redis-client", () => ({
  getRedisClient: () => fakeRedis,
}));

vi.mock("@workspace/db", () => ({
  db: {
    execute: vi.fn(async () => ({
      rows: [{ in_recovery: false, tro: "off" }],
    })),
  },
}));

import { bootMigrations } from "../../lib/boot-migrations";
import { runMigrations } from "../../migrate";

const mockRunMigrations = vi.mocked(runMigrations);

const ENV_KEYS = [
  "DISABLE_BOOT_MIGRATIONS",
  "MIGRATION_WRITE_WAIT_MAX_MS",
  "MIGRATION_WRITE_WAIT_POLL_MS",
  "MIGRATION_LEADER_WAIT_MAX_MS",
] as const;

const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  // Shrink the follower wait budget + probe polls; the real code paths
  // (re-resolution, error-keeps-waiting, budget match) are unaffected by
  // the magnitudes — only the env tunables are exercised.
  process.env.MIGRATION_WRITE_WAIT_MAX_MS = "50";
  process.env.MIGRATION_WRITE_WAIT_POLL_MS = "5";
  process.env.MIGRATION_LEADER_WAIT_MAX_MS = "1500";
  mockRunMigrations.mockReset();
  fakeRedis.set.mockClear();
  fakeRedis.exists.mockReset().mockResolvedValue(1);
  fakeRedis.eval.mockClear();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe("F7 — follower wait semantics (waitForLeader)", () => {
  it("a Redis error does NOT mean 'leader finished': the follower keeps waiting, then sees the lock released", async () => {
    // The old code `catch { return; }` — a single Redis hiccup opened the
    // boot gate while the leader was still migrating.
    let calls = 0;
    fakeRedis.exists.mockImplementation(async () => {
      calls += 1;
      if (calls === 1) throw new Error("connection reset mid-wait");
      return 0; // leader finished on the second poll
    });

    const result = await bootMigrations();

    // It WAITED for the second poll instead of fail-opening at the error.
    expect(fakeRedis.exists.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(result.ok).toBe(true);
    expect(result.outcome).toBe("skipped_lock");
    // The follower NEVER ran DDL itself.
    expect(mockRunMigrations).not.toHaveBeenCalled();
  });

  it("waits out the whole budget while the leader still holds the lock (TTL-matched, not 60s)", async () => {
    fakeRedis.exists.mockResolvedValue(1); // leader alive the entire window

    const started = Date.now();
    const result = await bootMigrations();
    const waitedMs = Date.now() - started;

    // The budget is the env-tunable 1500 ms (MIGRATION_LEADER_WAIT_MAX_MS
    // proxies the production LOCK_TTL_SEC*1000 = 300 s default). The old
    // hard-coded 60 s would have returned before the leader's 300 s TTL.
    expect(waitedMs).toBeGreaterThanOrEqual(1400);
    expect(result.ok).toBe(true);
    expect(result.outcome).toBe("skipped_lock");
    expect(mockRunMigrations).not.toHaveBeenCalled();
    // It kept polling the lock the whole time.
    expect(fakeRedis.exists.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("the follower proceeds normally once the lock disappears (no regression)", async () => {
    fakeRedis.exists.mockResolvedValue(0);

    const result = await bootMigrations();

    expect(result.ok).toBe(true);
    expect(result.outcome).toBe("skipped_lock");
    expect(mockRunMigrations).not.toHaveBeenCalled();
  });
});
