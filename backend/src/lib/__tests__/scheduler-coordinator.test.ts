import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RedisClientType } from "redis";

/**
 * Round-93 C3 (A3 audit R5/R6) — scheduler leadership resilience.
 *
 * R5: during a Redis outage the old leadership ops queued forever on the
 * dead socket — the TTL refresher iterations hang-stacked, and (worst)
 * `release()` on SIGTERM never settled: the graceful drain stalled until
 * the 10 s force-exit cut in-flight responses mid-byte and skipped pool
 * drain. Every leadership op is now bounded (SCHEDULER_OP_TIMEOUT_MS,
 * default 2 s — overridable for these tests).
 *
 * R6: losing the leader lock used to only log a warning while the
 * demoted instance kept firing EVERY cron/watcher/alert in parallel with
 * the new leader until the next deploy (split-brain) plus a warn-log
 * every 20 s. Now: isLeader flips false, the refresher stops, the
 * onLost callback fires (caller stops its schedulers), and the
 * acquisition loop restarts so the lock is re-taken if the new leader
 * dies.
 *
 * The coordinator talks to a fake RedisClientType; intervals are shrunk
 * via the refreshIntervalMs/retryIntervalMs test seams.
 */

const ENV_KEYS = ["SCHEDULER_OP_TIMEOUT_MS"] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  process.env.SCHEDULER_OP_TIMEOUT_MS = "30";
  vi.resetModules();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

const LEADER_KEY = "scheduler:leader";
const HANG = (): Promise<never> => new Promise(() => {});
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface FakeRedis {
  set: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  expire: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
}

function makeFakeRedis(): FakeRedis {
  return {
    set: vi.fn(() => Promise.resolve("OK")),
    get: vi.fn(() => Promise.resolve("someone-else")),
    expire: vi.fn(() => Promise.resolve(1)),
    del: vi.fn(() => Promise.resolve(1)),
  };
}

async function loadCoordinator() {
  return import("../scheduler-coordinator");
}

describe("R5 — leadership ops are bounded; release() never wedges the drain", () => {
  it("release() resolves within the op bound even when redis.get hangs forever", async () => {
    const redis = makeFakeRedis();
    redis.get.mockImplementation(HANG); // the R5 outage shape
    const { acquireSchedulerLeadership } = await loadCoordinator();

    const leadership = await acquireSchedulerLeadership(redis as never);
    expect(leadership.isLeader).toBe(true);

    const started = Date.now();
    const watchdog = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("release() hung — SIGTERM drain would stall (R5)")), 3_000),
    );
    await Promise.race([leadership.release(), watchdog]);

    // Bounded by SCHEDULER_OP_TIMEOUT_MS (30ms here) — far below the
    // 10s force-exit; generous upper bound for CI timer slack.
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(leadership.isLeader).toBe(false);
    // The compare-and-delete never ran — the GET timed out first.
    expect(redis.del).not.toHaveBeenCalledWith(LEADER_KEY);
  });

  it("release() still deletes the lock when redis answers in time", async () => {
    const redis = makeFakeRedis();
    const { acquireSchedulerLeadership } = await loadCoordinator();

    const leadership = await acquireSchedulerLeadership(redis as never);
    // Refresher/get returns OUR id → we still own it.
    redis.get.mockImplementation((key: string) =>
      Promise.resolve(key === LEADER_KEY ? leadership.instanceId : null),
    );

    await leadership.release();
    expect(redis.del).toHaveBeenCalledWith(LEADER_KEY);
    expect(leadership.isLeader).toBe(false);
  });

  it("the TTL refresher survives a hanging redis.get without piling up iterations", async () => {
    const redis = makeFakeRedis();
    redis.get.mockImplementation(HANG);
    const { acquireSchedulerLeadership } = await loadCoordinator();

    const leadership = await acquireSchedulerLeadership(redis as never, {
      refreshIntervalMs: 10,
    });
    // Let several refresher ticks fire against the hanging GET.
    await sleep(120);
    // R5: each iteration settles via the command timeout (no
    // hang-stacking) and leadership is retained — Redis being down must
    // not flip the state, only the TTL (60s) is the backstop.
    expect(leadership.isLeader).toBe(true);
    expect(redis.get.mock.calls.filter((c) => c[0] === LEADER_KEY).length).toBeGreaterThanOrEqual(
      2,
    );
    await leadership.release();
  });
});

describe("R6 — losing the lock DEMOTES this process (split-brain fix)", () => {
  it("fires onLost, flips isLeader false, stops refreshing, and re-acquires later", async () => {
    const redis = makeFakeRedis();
    const onAcquired = vi.fn();
    const onLost = vi.fn();
    const { acquireSchedulerLeadership } = await loadCoordinator();

    // Real-Redis semantics: our FIRST SETNX wins the free key; every
    // later SETNX is "busy" until the new leader's key expires — keeps the
    // fake consistent and prevents demote/re-acquire flapping while we wait.
    let setCalls = 0;
    redis.set.mockImplementation(() => {
      setCalls += 1;
      return Promise.resolve<string | null>(setCalls === 1 ? "OK" : null);
    });

    const leadership = await acquireSchedulerLeadership(redis as never, {
      onAcquired,
      onLost,
      refreshIntervalMs: 15,
      retryIntervalMs: 15,
    });

    // Won the initial SETNX race.
    expect(leadership.isLeader).toBe(true);
    expect(onAcquired).not.toHaveBeenCalled(); // initial win — not a retry

    // Another instance takes over: the refresher's next GET returns a
    // different holder id.
    redis.get.mockImplementation((_key: string) => Promise.resolve("instance-B"));
    await vi.waitFor(() => expect(onLost).toHaveBeenCalledTimes(1), { timeout: 2_000 });
    expect(leadership.isLeader).toBe(false);

    // The refresher stopped — no more warn-spam every tick: after several
    // refresh intervals, no additional GETs for the leader key arrive
    // (the acquisition retry loop only SETs).
    const getsAfterDemotion = redis.get.mock.calls.filter((c) => c[0] === LEADER_KEY).length;
    await sleep(80);
    expect(redis.get.mock.calls.filter((c) => c[0] === LEADER_KEY).length).toBe(getsAfterDemotion);

    // Re-acquisition: the new leader died without releasing, the TTL
    // expired — our next SETNX wins and the caller is notified.
    redis.set.mockImplementation(() => Promise.resolve("OK"));
    redis.get.mockImplementation((_key: string) => Promise.resolve(leadership.instanceId));
    await vi.waitFor(() => expect(onAcquired).toHaveBeenCalledTimes(1), { timeout: 2_000 });
    expect(leadership.isLeader).toBe(true);

    await leadership.release();
  });

  it("onLost callbacks that throw do not crash the refresher loop", async () => {
    const redis = makeFakeRedis();
    let setCalls = 0;
    redis.set.mockImplementation(() => {
      setCalls += 1;
      return Promise.resolve<string | null>(setCalls === 1 ? "OK" : null);
    });
    const onLost = vi.fn(() => {
      throw new Error("callback boom");
    });
    const { acquireSchedulerLeadership } = await loadCoordinator();

    const leadership = await acquireSchedulerLeadership(redis as never, {
      onLost,
      refreshIntervalMs: 15,
      retryIntervalMs: 15,
    });
    redis.get.mockImplementation((_key: string) => Promise.resolve("instance-B"));
    await vi.waitFor(() => expect(onLost).toHaveBeenCalledTimes(1), { timeout: 2_000 });
    // Demotion completed despite the throwing callback; the process is
    // still alive and the leadership object usable.
    expect(leadership.isLeader).toBe(false);
    await leadership.release();
  });

  it("acquisition against a hanging redis falls closed for this attempt but keeps retrying", async () => {
    const redis = makeFakeRedis();
    redis.set.mockImplementation(HANG); // outage at boot
    const onAcquired = vi.fn();
    const { acquireSchedulerLeadership } = await loadCoordinator();

    const leadership = await acquireSchedulerLeadership(redis as never, {
      onAcquired,
      retryIntervalMs: 15,
    });
    expect(leadership.isLeader).toBe(false);

    // Redis recovers: the retry loop wins the lock and notifies.
    redis.set.mockImplementation(() => Promise.resolve("OK"));
    redis.get.mockImplementation((_key: string) => Promise.resolve(leadership.instanceId));
    await vi.waitFor(() => expect(onAcquired).toHaveBeenCalledTimes(1), { timeout: 2_000 });
    expect(leadership.isLeader).toBe(true);

    await leadership.release();
  });
});

describe("F2 — redis null does NOT grant unguarded leadership (round-94 A6)", () => {
  it("returns isLeader=false (fail-closed) with a safe release", async () => {
    const { acquireSchedulerLeadership } = await loadCoordinator();
    const onAcquired = vi.fn();
    const leadership = await acquireSchedulerLeadership(null, {
      onAcquired,
      retryIntervalMs: 20,
    });
    // THE regression pin: the old dev fallback returned isLeader=true with
    // no refresher/no retry loop — reachable from production via the
    // degraded boot path, it produced split-brain cron until the next
    // deploy. Jobs must stop safely instead.
    expect(leadership.isLeader).toBe(false);
    expect(onAcquired).not.toHaveBeenCalled();
    await expect(leadership.release()).resolves.toBeUndefined();
    expect(leadership.isLeader).toBe(false);
    // Give the (unref'd, 20 ms) retry loop a few silent polls — it must
    // not warn-per-tick and must not spontaneously self-promote without
    // a real client (getRedisClient() is null in the test process).
    await sleep(80);
    expect(leadership.isLeader).toBe(false);
    expect(onAcquired).not.toHaveBeenCalled();
    await leadership.release();
  });

  it("acquires the REAL lock once Redis returns (degraded-boot recovery) and fires onAcquired", async () => {
    const redis = makeFakeRedis();
    let client: ReturnType<typeof makeFakeRedis> | null = null;
    const onAcquired = vi.fn();
    const { acquireSchedulerLeadership } = await loadCoordinator();

    const leadership = await acquireSchedulerLeadership(null, {
      onAcquired,
      retryIntervalMs: 15,
      // The lazy client source the retry loop polls (production default:
      // getRedisClient(); seam for this test). Cast through unknown — the
      // fake Redis satisfies the coordinator's structural usage, same as
      // the `redis as never` casts in the suites above.
      redisProvider: (() => client) as unknown as () => RedisClientType | null,
    });
    expect(leadership.isLeader).toBe(false); // fail-closed at boot

    // Redis comes back: SETNX wins, onAcquired fires, the refresher runs.
    redis.set.mockImplementation(() => Promise.resolve("OK"));
    redis.get.mockImplementation((_key: string) => Promise.resolve(leadership.instanceId));
    client = redis;
    await vi.waitFor(() => expect(onAcquired).toHaveBeenCalledTimes(1), { timeout: 2_000 });
    expect(leadership.isLeader).toBe(true);

    await leadership.release();
    expect(leadership.isLeader).toBe(false);
    expect(redis.del).toHaveBeenCalledWith(LEADER_KEY);
  });
});
