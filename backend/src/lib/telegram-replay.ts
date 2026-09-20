/**
 * Telegram Login / Mini App — single-use replay-hash store.
 *
 * Moved here from routes/auth-settings.ts (round-93, 93-A1 S3) so the
 * store is unit-testable without importing the whole routes module and
 * so the TTL policy lives next to the freshness windows it must cover.
 *
 * 93-A1 S3 (round-93) — two defects in the previous shape:
 *
 *   1. TTL mismatch: the store claimed hashes with
 *      `EX: TELEGRAM_AUTH_FRESHNESS_SEC` (30 min) for BOTH flows, but
 *      the Mini App flow validates `initData` freshness over
 *      TELEGRAM_WEBAPP_FRESHNESS_SEC (24 h). A captured initData could
 *      be replayed from T+31 min … T+24 h: freshness passes, the
 *      expired replay key is re-claimable, a fresh 30-day session JWT
 *      is minted. A replay-store TTL must NEVER be shorter than the
 *      validity window it guards — each flow now passes its own
 *      TTL (freshness + slack, see constants below).
 *
 *   2. Fail-open without Redis: `getRedisClient()` returns null in the
 *      CURRENT production shape (REDIS_URL unset — verified by the live
 *      /api/healthz/summary degraded response), so the old code
 *      returned `true` unconditionally: ZERO replay dedup for both the
 *      widget and webapp flows. The claim now falls back to a bounded
 *      in-process store (exact-key, TTL'd, size-capped) so single-
 *      instance deployments — the current shape — still get replay
 *      protection. Multi-instance dedup remains a Redis concern
 *      (documented limitation, mirrors the rate-limiter posture).
 *
 * Returns `false` (replay rejected) if the hash was already claimed and
 * its entry is still live.
 */

import { logger } from "./logger";
import { getRedisClient, withRedisCommandTimeout } from "./redis-client";
import { TELEGRAM_AUTH_FRESHNESS_SEC, TELEGRAM_WEBAPP_FRESHNESS_SEC } from "./telegram-auth";

/**
 * Login Widget replay window: freshness (30 min) + 5 min slack so the
 * store key never expires before the payload it guards goes stale.
 */
export const TELEGRAM_WIDGET_REPLAY_TTL_SEC = TELEGRAM_AUTH_FRESHNESS_SEC + 5 * 60;

/**
 * Mini App / WebApp replay window: freshness (24 h) + 1 h slack = 25 h.
 * The S3 invariant this constant exists to protect: TTL ≥ the 24 h
 * initData freshness window — a regression test pins it.
 */
export const TELEGRAM_WEBAPP_REPLAY_TTL_SEC = TELEGRAM_WEBAPP_FRESHNESS_SEC + 60 * 60;

/** Default cap for the no-Redis fallback store — bounds memory under a
 * replay-flood (5 000 × 64-char hash keys ≈ 0.5 MB). Mutable only for
 * tests via __test.setMemoryStoreLimit. */
const REPLAY_MEMORY_MAX_ENTRIES = 5_000;
let memoryStoreLimit = REPLAY_MEMORY_MAX_ENTRIES;

/** Prune expired entries every N claims (opportunistic — no timer). */
const REPLAY_MEMORY_PRUNE_EVERY = 250;

const replayMemoryStore = new Map<string, number>(); // hash → expiry epoch ms
let memoryPruneCounter = 0;

function pruneExpiredMemoryEntries(now: number): void {
  for (const [key, expiry] of replayMemoryStore) {
    if (expiry <= now) replayMemoryStore.delete(key);
  }
}

/**
 * Bounded in-memory claim used when Redis is unavailable (or errored).
 * Map preserves insertion order, so eviction under pressure drops the
 * OLDEST claim — an attacker flooding the store can only ever replay
 * the entries they evicted themselves, never a fresh victim's hash.
 */
function claimReplayHashInMemory(hash: string, ttlSec: number): boolean {
  const now = Date.now();
  if (++memoryPruneCounter % REPLAY_MEMORY_PRUNE_EVERY === 0) {
    pruneExpiredMemoryEntries(now);
  }

  const existing = replayMemoryStore.get(hash);
  if (existing !== undefined) {
    if (existing > now) return false; // already claimed + still live → replay
    replayMemoryStore.delete(hash); // expired entry — re-claimable
  }

  if (replayMemoryStore.size >= memoryStoreLimit) {
    const oldest = replayMemoryStore.keys().next().value;
    if (oldest !== undefined) replayMemoryStore.delete(oldest);
  }
  replayMemoryStore.set(hash, now + ttlSec * 1000);
  return true;
}

/**
 * Single-use replay protection. Records the hash with a TTL matching the
 * flow's freshness window (+ slack). Redis NX/EX when available; on a
 * Redis error the claim falls through to the in-memory fallback (rather
 * than the old unconditional accept); when Redis is entirely absent
 * (current production) the in-memory store IS the protection.
 *
 * @returns `false` when the hash was already claimed (replay rejected).
 */
export async function claimTelegramReplayHash(hash: string, ttlSec: number): Promise<boolean> {
  const redis = getRedisClient();
  if (redis) {
    try {
      // F3 (round-98, 98-F5): bounded per the repo-wide R2 rule — a hung
      // claim used to stall /api/auth/telegram login forever (dormant
      // until REDIS_URL returns, but the discipline is repo-wide).
      const result = await withRedisCommandTimeout(
        "tg_replay_set",
        () => redis.set(`tg-login:hash:${hash}`, "1", { NX: true, EX: ttlSec }),
        1_000,
      );
      return result === "OK";
    } catch (err) {
      // 93-A1 S3: a transient Redis error used to fail OPEN
      // unconditionally. The memory store is a strictly better fallback
      // (exact-key dedup for the single-instance shape), so route the
      // claim through it instead. The freshness window remains the
      // primary defense either way.
      logger.warn(
        { category: "auth", err: err instanceof Error ? err.message : String(err) },
        "[telegram-replay] Redis claim failed — falling back to in-memory store",
      );
    }
  }
  return claimReplayHashInMemory(hash, ttlSec);
}

/** Test-only hooks: isolate + shrink the memory store between cases. */
export const __test = {
  resetMemoryStore(): void {
    replayMemoryStore.clear();
    memoryPruneCounter = 0;
  },
  setMemoryStoreLimit(limit: number): number {
    const previous = memoryStoreLimit;
    memoryStoreLimit = limit;
    return previous;
  },
  memoryStoreSize(): number {
    return replayMemoryStore.size;
  },
};
