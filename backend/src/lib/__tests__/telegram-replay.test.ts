import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TELEGRAM_AUTH_FRESHNESS_SEC, TELEGRAM_WEBAPP_FRESHNESS_SEC } from "../telegram-auth";
import {
  TELEGRAM_WEBAPP_REPLAY_TTL_SEC,
  TELEGRAM_WIDGET_REPLAY_TTL_SEC,
  __test,
  claimTelegramReplayHash,
} from "../telegram-replay";
import { getRedisClient } from "../redis-client";

/**
 * 93-A1 S3 (round-93) — Telegram replay-store coverage.
 *
 * Two defects are pinned here:
 *
 *   1. TTL ≥ freshness invariant: the store's TTL for each flow must
 *      NEVER be shorter than the validity window it guards. The old
 *      code claimed WebApp hashes with the WIDGET's 30-minute TTL
 *      while accepting 24-hour-old initData — a captured payload was
 *      re-playable from T+31 min to T+24 h.
 *   2. No-Redis fallback: production currently runs WITHOUT Redis
 *      (live /api/healthz/summary = degraded), where the old
 *      claimTelegramReplayHash returned `true` unconditionally — zero
 *      replay dedup. The bounded in-memory store now provides it.
 *
 * The Redis branch is exercised via a mocked getRedisClient (the
 * sandbox has no Redis); assertions capture the exact key/TTL/NX-EX
 * arguments the real client would receive.
 */

vi.mock("../redis-client", () => ({
  getRedisClient: vi.fn(),
}));

const getRedisClientMock = vi.mocked(getRedisClient);

/** Capture-redis: records set() args, replays a scripted return value. */
function installCaptureRedis(behavior: { setReturns: unknown } | { setThrows: Error }): {
  setCalls: Array<{ key: string; value: string; opts: { NX: boolean; EX: number } }>;
} {
  const setCalls: Array<{ key: string; value: string; opts: { NX: boolean; EX: number } }> = [];
  getRedisClientMock.mockReturnValue({
    set: async (key: string, value: string, opts: { NX: boolean; EX: number }) => {
      setCalls.push({ key, value, opts });
      if ("setThrows" in behavior) throw behavior.setThrows;
      return behavior.setReturns;
    },
  } as unknown as ReturnType<typeof getRedisClient>);
  return { setCalls };
}

beforeEach(() => {
  __test.resetMemoryStore();
  // Default: NO Redis — the current production shape.
  getRedisClientMock.mockReturnValue(null);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("TTL ≥ freshness invariant (93-A1 S3 defect 1)", () => {
  it("widget replay TTL ≥ widget freshness window (30 min)", () => {
    expect(TELEGRAM_WIDGET_REPLAY_TTL_SEC).toBeGreaterThanOrEqual(TELEGRAM_AUTH_FRESHNESS_SEC);
  });

  it("webapp replay TTL ≥ the 24 h initData freshness window (the S3 hole)", () => {
    expect(TELEGRAM_WEBAPP_REPLAY_TTL_SEC).toBeGreaterThanOrEqual(TELEGRAM_WEBAPP_FRESHNESS_SEC);
  });

  it("webapp TTL is freshness + 1 h slack = 25 h exactly", () => {
    expect(TELEGRAM_WEBAPP_REPLAY_TTL_SEC).toBe(25 * 60 * 60);
  });
});

describe("in-memory fallback (93-A1 S3 defect 2 — no Redis in prod)", () => {
  it("first claim of a hash → true; replay of the SAME hash while live → false", async () => {
    await expect(claimTelegramReplayHash("hash-aaa", 3600)).resolves.toBe(true);
    await expect(claimTelegramReplayHash("hash-aaa", 3600)).resolves.toBe(false);
  });

  it("distinct hashes do not interfere", async () => {
    await expect(claimTelegramReplayHash("hash-aaa", 3600)).resolves.toBe(true);
    await expect(claimTelegramReplayHash("hash-bbb", 3600)).resolves.toBe(true);
    await expect(claimTelegramReplayHash("hash-aaa", 3600)).resolves.toBe(false);
    await expect(claimTelegramReplayHash("hash-bbb", 3600)).resolves.toBe(false);
  });

  it("a hash becomes re-claimable after its TTL expires (bounded memory, not a permanent ban)", async () => {
    vi.useFakeTimers();
    await expect(claimTelegramReplayHash("hash-aaa", 60)).resolves.toBe(true);
    vi.advanceTimersByTime(61_000);
    // Fresh probe after expiry — re-claimable (freshness would have
    // rejected the underlying payload long before this matters).
    await expect(claimTelegramReplayHash("hash-aaa", 60)).resolves.toBe(true);
  });

  it("store is size-capped — the OLDEST entry is evicted under pressure", async () => {
    const previous = __test.setMemoryStoreLimit(3);
    try {
      await expect(claimTelegramReplayHash("h1", 3600)).resolves.toBe(true);
      await expect(claimTelegramReplayHash("h2", 3600)).resolves.toBe(true);
      await expect(claimTelegramReplayHash("h3", 3600)).resolves.toBe(true);
      expect(__test.memoryStoreSize()).toBe(3);
      // h4 exceeds the cap → h1 (oldest insert) is evicted…
      await expect(claimTelegramReplayHash("h4", 3600)).resolves.toBe(true);
      expect(__test.memoryStoreSize()).toBe(3);
      // …so h1's claim is forgotten (re-claimable), while h3 — still
      // resident — keeps deduplicating.
      await expect(claimTelegramReplayHash("h1", 3600)).resolves.toBe(true);
      await expect(claimTelegramReplayHash("h3", 3600)).resolves.toBe(false);
    } finally {
      __test.setMemoryStoreLimit(previous);
    }
  });

  it("expired entries are pruned — the store is bounded, not a permanent memory leak", async () => {
    vi.useFakeTimers();
    // 3 seed claims + 247 loop claims = claim #250 exactly — the claim
    // whose counter tick fires the opportunistic prune. Every prior
    // entry has expired by then (31 s advanced per 30 s TTL), so the
    // prune empties the store before inserting claim #250.
    await expect(claimTelegramReplayHash("h1", 30)).resolves.toBe(true);
    await expect(claimTelegramReplayHash("h2", 30)).resolves.toBe(true);
    await expect(claimTelegramReplayHash("h3", 30)).resolves.toBe(true);
    for (let i = 0; i < 247; i++) {
      vi.advanceTimersByTime(31_000);
      await claimTelegramReplayHash(`batch-${i}`, 30);
    }
    expect(__test.memoryStoreSize()).toBe(1);
  });
});

describe("Redis branch (mocked client — arg contract)", () => {
  it("claims with SET key value NX EX <ttlSec> and maps 'OK' → true", async () => {
    const { setCalls } = installCaptureRedis({ setReturns: "OK" });
    await expect(claimTelegramReplayHash("hash-xyz", 1234)).resolves.toBe(true);
    expect(setCalls).toHaveLength(1);
    expect(setCalls[0].key).toBe("tg-login:hash:hash-xyz");
    expect(setCalls[0].value).toBe("1");
    expect(setCalls[0].opts).toEqual({ NX: true, EX: 1234 });
  });

  it("a non-OK return (key already exists — replay) → false", async () => {
    installCaptureRedis({ setReturns: null });
    await expect(claimTelegramReplayHash("hash-xyz", 1234)).resolves.toBe(false);
  });

  it("a Redis ERROR falls back to the memory store instead of failing open (S3 defect 2)", async () => {
    vi.useFakeTimers();
    installCaptureRedis({ setThrows: new Error("ECONNRESET") });
    // First claim: Redis throws → memory store claims it.
    await expect(claimTelegramReplayHash("hash-err", 3600)).resolves.toBe(true);
    // Replay of the same hash: Redis throws again → memory store REJECTS.
    // The old code returned true unconditionally here.
    await expect(claimTelegramReplayHash("hash-err", 3600)).resolves.toBe(false);
  });
});
