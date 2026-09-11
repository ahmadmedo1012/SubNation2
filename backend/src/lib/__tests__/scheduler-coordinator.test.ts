import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RedisClientType } from "redis";
import type {
  SchedulerLeaseAcquireOutcome,
  SchedulerLeaseRefreshOutcome,
  SchedulerLeaseReleaseOutcome,
} from "../pg-leader-lease";

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

/**
 * 97-F1: fake of the PG leader-lease backend the coordinator drives when
 * the Redis client resolves to null. Mocked at the backend boundary — the
 * lease SQL/pool layer has its own suite (pg-leader-lease.test.ts). The
 * mocks are typed to the REAL outcome unions so the fake satisfies
 * SchedulerLeaderLeaseBackend without casts.
 */
function makeFakePgLease() {
  return {
    acquire: vi.fn<(holder: string, ttlSec: number) => Promise<SchedulerLeaseAcquireOutcome>>(
      async () => "busy",
    ),
    refresh: vi.fn<(holder: string, ttlSec: number) => Promise<SchedulerLeaseRefreshOutcome>>(
      async () => "renewed",
    ),
    release: vi.fn<(holder: string) => Promise<SchedulerLeaseReleaseOutcome>>(
      async () => "released",
    ),
  };
}

/**
 * 97-F1: a fake PG lease backend with REAL singleton-row semantics, shared
 * across two coordinator instances to pin cross-instance behavior (busy →
 * release → other instance acquires).
 */
function makeSharedPgLease() {
  let holder: string | null = null;
  return {
    acquire: vi.fn(async (h: string) => {
      if (holder === null || holder === h) {
        holder = h;
        return "acquired" as const;
      }
      return "busy" as const;
    }),
    refresh: vi.fn(async (h: string) => (holder === h ? ("renewed" as const) : ("lost" as const))),
    release: vi.fn(async (h: string) => {
      if (holder === h) {
        holder = null;
        return "released" as const;
      }
      return "not-held" as const;
    }),
    currentHolder: () => holder,
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

describe("F2/97-F1 — redis null does NOT grant UNGUARDED leadership (round-94 A6 → round-97 F1)", () => {
  it("a broken PG lease backend is fail-closed: no leadership, safe release, no self-promotion", async () => {
    const { acquireSchedulerLeadership } = await loadCoordinator();
    const onAcquired = vi.fn();
    const lease = makeFakePgLease();
    // The lease evaluation itself fails (DB down / table bootstrap failed):
    // every attempt maps to "error" — the coordinator must NOT grant
    // leadership it could not verify, and must keep retrying silently.
    lease.acquire.mockImplementation(async () => "error");

    const leadership = await acquireSchedulerLeadership(null, {
      onAcquired,
      retryIntervalMs: 20,
      pgLeaseBackend: lease,
    });
    // THE regression pin (F2 spirit, preserved through 97-F1): jobs stop
    // safely instead of an unguarded isLeader=true. The old dev fallback
    // produced split-brain cron until the next deploy.
    expect(leadership.isLeader).toBe(false);
    expect(onAcquired).not.toHaveBeenCalled();
    // Give the (unref'd, 20 ms) retry loop a few silent polls — it must
    // not self-promote while the backend keeps erroring, but it MUST keep
    // re-attempting (B7-P1-1: a forever-erroring boot must not mean
    // forever-dark schedulers once the DB answers again).
    await sleep(80);
    expect(leadership.isLeader).toBe(false);
    expect(onAcquired).not.toHaveBeenCalled();
    expect(lease.acquire.mock.calls.length).toBeGreaterThan(1); // it DID keep retrying
    await expect(leadership.release()).resolves.toBeUndefined();
    expect(leadership.isLeader).toBe(false);
  });

  it("acquires the REAL lock once Redis returns (degraded-boot recovery) and fires onAcquired", async () => {
    const redis = makeFakeRedis();
    let client: ReturnType<typeof makeFakeRedis> | null = null;
    const onAcquired = vi.fn();
    // 97-F1: while Redis is gone the loop rides the PG lease; inject a
    // backend that is busy (another instance holds the lease) so the
    // default shared-pool backend is never touched by this suite.
    const lease = makeFakePgLease();
    const { acquireSchedulerLeadership } = await loadCoordinator();

    const leadership = await acquireSchedulerLeadership(null, {
      onAcquired,
      retryIntervalMs: 15,
      // The lazy client source the retry loop polls (production default:
      // getRedisClient(); seam for this test). Cast through unknown — the
      // fake Redis satisfies the coordinator's structural usage, same as
      // the `redis as never` casts in the suites above.
      redisProvider: (() => client) as unknown as () => RedisClientType | null,
      pgLeaseBackend: lease,
    });
    expect(leadership.isLeader).toBe(false); // fail-closed at boot
    expect(lease.acquire).toHaveBeenCalled(); // 97-F1: the PG fallback engaged

    // Redis comes back: it is the PRIMARY backend — SETNX wins (the PG
    // lease never grants this leadership), onAcquired fires, the
    // refresher runs against Redis.
    redis.set.mockImplementation(() => Promise.resolve("OK"));
    redis.get.mockImplementation((_key: string) => Promise.resolve(leadership.instanceId));
    client = redis;
    await vi.waitFor(() => expect(onAcquired).toHaveBeenCalledTimes(1), { timeout: 2_000 });
    expect(leadership.isLeader).toBe(true);
    expect(lease.refresh).not.toHaveBeenCalled(); // refresh went to Redis, not PG

    await leadership.release();
    expect(leadership.isLeader).toBe(false);
    expect(redis.del).toHaveBeenCalledWith(LEADER_KEY);
    expect(lease.release).not.toHaveBeenCalled(); // release went to Redis, not PG
  });
});

describe("97-F1 — PG leader lease fallback when Redis is unavailable", () => {
  it("acquires leadership via the PG lease backend on the FIRST attempt (initial win)", async () => {
    const lease = makeFakePgLease();
    lease.acquire.mockImplementation(async () => "acquired");
    const onAcquired = vi.fn();
    const { acquireSchedulerLeadership } = await loadCoordinator();

    const leadership = await acquireSchedulerLeadership(null, {
      onAcquired,
      pgLeaseBackend: lease,
    });

    expect(leadership.isLeader).toBe(true);
    expect(onAcquired).not.toHaveBeenCalled(); // initial win — not a retry
    expect(lease.acquire).toHaveBeenCalledWith(leadership.instanceId, 60);

    await leadership.release();
    expect(leadership.isLeader).toBe(false);
    expect(lease.release).toHaveBeenCalledWith(leadership.instanceId);
  });

  it("PG-busy at boot retries on the retry timer and fires onAcquired once the lease frees", async () => {
    const lease = makeFakePgLease();
    lease.acquire
      .mockImplementationOnce(async () => "busy")
      .mockImplementation(async () => "acquired");
    const onAcquired = vi.fn();
    const { acquireSchedulerLeadership } = await loadCoordinator();

    const leadership = await acquireSchedulerLeadership(null, {
      onAcquired,
      retryIntervalMs: 15,
      pgLeaseBackend: lease,
    });
    expect(leadership.isLeader).toBe(false);

    // The old holder's release (or TTL expiry) frees the lease — the retry
    // loop wins it and notifies the caller.
    await vi.waitFor(() => expect(onAcquired).toHaveBeenCalledTimes(1), { timeout: 2_000 });
    expect(leadership.isLeader).toBe(true);

    await leadership.release();
  });

  it("refresh 'lost' DEMOTES immediately, stops refreshing, and re-acquires later", async () => {
    const lease = makeFakePgLease();
    lease.acquire.mockImplementationOnce(async () => "acquired");
    const onAcquired = vi.fn();
    const onLost = vi.fn();
    const { acquireSchedulerLeadership } = await loadCoordinator();

    const leadership = await acquireSchedulerLeadership(null, {
      onAcquired,
      onLost,
      refreshIntervalMs: 15,
      retryIntervalMs: 15,
      pgLeaseBackend: lease,
    });
    expect(leadership.isLeader).toBe(true);

    // Another instance took the lease over after our expiry. Park
    // re-acquisition ("busy") so the demotion itself is observable before
    // the recovery phase — same shape as the R6 Redis suite above.
    lease.acquire.mockImplementation(async () => "busy");
    lease.refresh.mockImplementation(async () => "lost");
    await vi.waitFor(() => expect(onLost).toHaveBeenCalledTimes(1), { timeout: 2_000 });
    expect(leadership.isLeader).toBe(false);

    // The refresher stopped — no more refresh calls after demotion.
    const refreshCallsAfterDemotion = lease.refresh.mock.calls.length;
    await sleep(80);
    expect(lease.refresh.mock.calls.length).toBe(refreshCallsAfterDemotion);

    // Re-acquisition: the new leader died — our next acquire wins the lease
    // back (same-holder re-acquire is idempotent in the lease SQL) and the
    // caller restarts its schedulers via onAcquired.
    lease.acquire.mockImplementation(async () => "acquired");
    lease.refresh.mockImplementation(async () => "renewed");
    await vi.waitFor(() => expect(onAcquired).toHaveBeenCalledTimes(1), { timeout: 2_000 });
    expect(leadership.isLeader).toBe(true);

    await leadership.release();
  });

  it("refresh 'error' (unverifiable holdership) ALSO demotes — fail-closed", async () => {
    const lease = makeFakePgLease();
    lease.acquire.mockImplementationOnce(async () => "acquired");
    const onLost = vi.fn();
    const { acquireSchedulerLeadership } = await loadCoordinator();

    const leadership = await acquireSchedulerLeadership(null, {
      onLost,
      refreshIntervalMs: 15,
      retryIntervalMs: 15,
      pgLeaseBackend: lease,
    });
    expect(leadership.isLeader).toBe(true);

    // A DB hiccup means we could NOT verify we still hold the lease — an
    // unverified lease must never keep firing schedulers. Demote (the
    // retry loop re-acquires as soon as the DB answers again — parked on
    // "busy" here so the demotion itself is observable).
    lease.acquire.mockImplementation(async () => "busy");
    lease.refresh.mockImplementation(async () => "error");
    await vi.waitFor(() => expect(onLost).toHaveBeenCalledTimes(1), { timeout: 2_000 });
    expect(leadership.isLeader).toBe(false);

    await leadership.release();
  });

  it("release() frees the shared lease — ANOTHER instance can then acquire", async () => {
    const shared = makeSharedPgLease();
    const { acquireSchedulerLeadership } = await loadCoordinator();

    const leaderA = await acquireSchedulerLeadership(null, {
      pgLeaseBackend: shared,
      refreshIntervalMs: 15,
    });
    expect(leaderA.isLeader).toBe(true);
    expect(shared.currentHolder()).toBe(leaderA.instanceId);

    // A second instance boots while A holds the lease → busy, retry loop
    // parked on a long interval so it cannot race the handover below.
    const standby = await acquireSchedulerLeadership(null, {
      pgLeaseBackend: shared,
      retryIntervalMs: 30_000,
    });
    expect(standby.isLeader).toBe(false);

    // A shuts down gracefully → its release deletes its lease row → the
    // NEXT instance to attempt acquisition becomes leader.
    await leaderA.release();
    expect(shared.currentHolder()).toBeNull();

    const leaderC = await acquireSchedulerLeadership(null, { pgLeaseBackend: shared });
    expect(leaderC.isLeader).toBe(true);
    expect(shared.currentHolder()).toBe(leaderC.instanceId);

    await leaderC.release();
    await standby.release();
  });

  it("Redis REMAINS the primary backend when a client exists — the PG lease is never consulted", async () => {
    const redis = makeFakeRedis();
    const lease = makeFakePgLease();
    const { acquireSchedulerLeadership } = await loadCoordinator();

    const leadership = await acquireSchedulerLeadership(redis as never, {
      pgLeaseBackend: lease,
    });

    expect(leadership.isLeader).toBe(true);
    expect(redis.set).toHaveBeenCalledWith(LEADER_KEY, leadership.instanceId, {
      NX: true,
      EX: 60,
    });
    expect(lease.acquire).not.toHaveBeenCalled();

    // The release compare-and-delete still runs against REDIS (the fake's
    // GET returns our id → we still own it → DEL fires).
    redis.get.mockImplementation((_key: string) => Promise.resolve(leadership.instanceId));
    await leadership.release();
    expect(redis.del).toHaveBeenCalledWith(LEADER_KEY);
    expect(lease.release).not.toHaveBeenCalled();
  });

  it("a PG leader HANDS OVER when Redis comes back: releases the lease, demotes, re-takes the real Redis lock", async () => {
    const lease = makeFakePgLease();
    lease.acquire.mockImplementationOnce(async () => "acquired");
    const redis = makeFakeRedis();
    let client: ReturnType<typeof makeFakeRedis> | null = null;
    const onAcquired = vi.fn();
    const onLost = vi.fn();
    const { acquireSchedulerLeadership } = await loadCoordinator();

    const leadership = await acquireSchedulerLeadership(null, {
      onAcquired,
      onLost,
      refreshIntervalMs: 15,
      retryIntervalMs: 15,
      redisProvider: (() => client) as unknown as () => RedisClientType | null,
      pgLeaseBackend: lease,
    });
    expect(leadership.isLeader).toBe(true); // won via the PG lease

    // Redis returns (degraded boot healed / REDIS_URL re-added): the next
    // refresher tick must release the PG lease and demote — a PG leader and
    // a Redis leader must never run schedulers in parallel indefinitely.
    redis.set.mockImplementation(() => Promise.resolve("OK"));
    redis.get.mockImplementation((_key: string) => Promise.resolve(leadership.instanceId));
    client = redis;

    await vi.waitFor(() => expect(onLost).toHaveBeenCalledTimes(1), { timeout: 2_000 });
    // NOTE: no intermediate isLeader===false assertion here — the retry loop
    // (15 ms) re-takes the Redis lock within the same instant the 50 ms
    // waitFor poll first observes onLost. The demotion is proven by onLost
    // itself (which only fires from a real demote) + the lease release.
    expect(lease.release).toHaveBeenCalledWith(leadership.instanceId);

    // The retry loop then competes for the REAL Redis lock and wins it.
    await vi.waitFor(() => expect(onAcquired).toHaveBeenCalledTimes(1), { timeout: 2_000 });
    expect(leadership.isLeader).toBe(true);
    expect(redis.set).toHaveBeenCalledWith(LEADER_KEY, leadership.instanceId, {
      NX: true,
      EX: 60,
    });

    // Final release goes to Redis — the PG lease was only released once
    // (the handover).
    await leadership.release();
    expect(redis.del).toHaveBeenCalledWith(LEADER_KEY);
    expect(lease.release).toHaveBeenCalledTimes(1);
  });
});
