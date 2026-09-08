import { describe, expect, it, vi } from "vitest";
import type { RedisClientType } from "redis";
import { acquireSchedulerLeadership } from "../src/lib/scheduler-coordinator";

/**
 * B7-P1-1 (round-92): leadership acquisition was ONE-SHOT at boot. Render
 * blue-green deploys boot the new instance while the old one still holds
 * `scheduler:leader` → new instance returned isLeader=false FOREVER; the
 * old instance then exits and releases → nobody ran cron/watchers/alerting
 * until the next restart.
 *
 * The fix: a failed acquisition starts a retry loop (default 20 s, shrunk
 * to 10 ms here via retryIntervalMs) that keeps re-attempting until the
 * lock frees up, flips the LIVE isLeader flag, and fires onAcquired so
 * the caller starts its schedulers.
 */

interface FakeRedisState {
  value: string | null;
  failNextSets: number;
}

function fakeRedis(initial: string | null) {
  const state: FakeRedisState = { value: initial, failNextSets: 0 };
  const set = vi.fn(async (_key: string, id: string, opts: { NX?: boolean }) => {
    if (state.failNextSets > 0) {
      state.failNextSets -= 1;
      throw new Error("redis timeout");
    }
    if (opts?.NX && state.value !== null) return null;
    state.value = id;
    return "OK";
  });
  const redis = {
    set,
    get: vi.fn(async () => state.value),
    expire: vi.fn(async () => 1),
    del: vi.fn(async () => {
      state.value = null;
      return 1;
    }),
  } as unknown as RedisClientType;
  return { redis, state, set };
}

describe("acquireSchedulerLeadership — retry until acquired (B7-P1-1)", () => {
  it("wins immediately when the lock is free (onAcquired NOT fired — caller starts jobs itself)", async () => {
    const { redis } = fakeRedis(null);
    const onAcquired = vi.fn();
    const leadership = await acquireSchedulerLeadership(redis, { onAcquired });
    expect(leadership.isLeader).toBe(true);
    expect(onAcquired).not.toHaveBeenCalled();
    await leadership.release();
  });

  it("keeps retrying while the old instance holds the lock, then takes over when it releases", async () => {
    const { redis, state } = fakeRedis("old-instance-blue-green");
    const onAcquired = vi.fn();
    const leadership = await acquireSchedulerLeadership(redis, {
      onAcquired,
      retryIntervalMs: 10,
    });

    // Initial acquisition failed — not leader, but not terminal either.
    expect(leadership.isLeader).toBe(false);
    expect(onAcquired).not.toHaveBeenCalled();

    // Simulate the old instance's SIGTERM release ~25ms into the wait.
    setTimeout(() => {
      state.value = null;
    }, 25);

    await vi.waitFor(() => expect(leadership.isLeader).toBe(true), { timeout: 2000 });
    expect(onAcquired).toHaveBeenCalledTimes(1);
    await leadership.release();
  });

  it("treats Redis errors during acquisition as retryable (no permanent leaderless boot)", async () => {
    const { redis, state } = fakeRedis(null);
    state.failNextSets = 2; // first two attempts hit a Redis hiccup
    const onAcquired = vi.fn();
    const leadership = await acquireSchedulerLeadership(redis, {
      onAcquired,
      retryIntervalMs: 5,
    });
    // Boot-time error → declines for now…
    expect(leadership.isLeader).toBe(false);
    // …but the retry loop recovers once Redis answers.
    await vi.waitFor(() => expect(leadership.isLeader).toBe(true), { timeout: 2000 });
    expect(onAcquired).toHaveBeenCalledTimes(1);
    await leadership.release();
  });

  it("release() before acquisition cancels the retry loop (no zombie takeover)", async () => {
    const { redis, state } = fakeRedis("old-instance");
    const onAcquired = vi.fn();
    const leadership = await acquireSchedulerLeadership(redis, {
      onAcquired,
      retryIntervalMs: 10,
    });
    expect(leadership.isLeader).toBe(false);
    await leadership.release();

    // The old lock frees up AFTER our release — we must NOT take over.
    state.value = null;
    await new Promise((r) => setTimeout(r, 60));
    expect(leadership.isLeader).toBe(false);
    expect(onAcquired).not.toHaveBeenCalled();
  });

  it("never grants leadership without Redis (F2 fail-closed — dev sets REDIS_URL to run schedulers)", async () => {
    // Round-94 A6/F2: the old unguarded dev fallback let a degraded boot
    // claim leadership with NO lock — paired with a stale leader on the
    // previous deploy, every cron double-ran until the next restart.
    // The contract is now fail-closed: no Redis ⇒ no leadership, the
    // retry loop silently polls getRedisClient(), and one warn covers
    // the whole null-client episode. Dev without Redis: set REDIS_URL.
    const leadership = await acquireSchedulerLeadership(null, {
      retryIntervalMs: 10,
    });
    expect(leadership.isLeader).toBe(false);
    // Give the retry loop a few poll ticks — it must stay fail-closed.
    await new Promise((r) => setTimeout(r, 60));
    expect(leadership.isLeader).toBe(false);
    await leadership.release();
  });
});
