/**
 * R154 (P2) — Telegram OIDC authorization-flow state store.
 *
 * The modern Telegram Login OIDC flow (core.telegram.org/bots/telegram-login,
 * "Manual Implementation") is a standard Authorization Code Flow with PKCE:
 * the backend issues a single-use `state` (CSRF), a `code_verifier` (PKCE)
 * and a `nonce` (replay) before redirecting to oauth.telegram.org, and the
 * callback must consume them EXACTLY once. This store owns that lifecycle.
 *
 * Shape mirrors lib/telegram-replay.ts: Redis when available (current
 * production may run without it — REDIS_URL unset), with a bounded
 * in-memory fallback so the single-instance shape keeps the single-use
 * guarantee. Multi-instance consumption remains a Redis concern (same
 * documented limitation as the replay store).
 *
 * Unlike the replay store (NX claim semantics), this one WRITES a value at
 * flow start and CONSUMES it (GETDEL) at callback: the state is not a
 * dedup key but a short-lived record binding {verifier, nonce, redirect,
 * referralCode} to one in-flight browser round-trip.
 */

import { logger } from "./logger";
import { getRedisClient, withRedisCommandTimeout } from "./redis-client";

/**
 * In-flight flow window: the user must complete the Telegram authorization
 * consent + redirect within 10 minutes. Long enough for the slowest real
 * consent screen, short enough that an abandoned flow's verifier/nonce die
 * quickly (defense-in-depth on top of their single-use semantics).
 */
export const TELEGRAM_OIDC_STATE_TTL_SEC = 10 * 60;

export interface TelegramOidcStateValue {
  /** PKCE code_verifier (base64url, 43-128 chars). */
  verifier: string;
  /** OIDC nonce — must reappear in the ID token. */
  nonce: string;
  /** Sanitized internal path to land on after login (null → default). */
  redirect: string | null;
  /** Referral code captured at flow start (uppercase, ≤16). */
  referralCode: string | null;
  /**
   * R191 (backend mobile contracts): the flow was started by the NATIVE
   * app (?native=1) — the callback must hand the minted session to the
   * app's own URL scheme instead of the web redirect. Absent/false = the
   * ordinary web flow.
   */
  native?: boolean;
  /** Creation epoch ms (fallback-store expiry + telemetry). */
  createdAt: number;
}

/** Default cap for the no-Redis fallback store (5 000 × ~300 B ≈ 1.5 MB). */
const OIDC_MEMORY_MAX_ENTRIES = 5_000;
let memoryStoreLimit = OIDC_MEMORY_MAX_ENTRIES;

const memoryStore = new Map<string, { value: TelegramOidcStateValue; expiry: number }>();

function evictMemoryIfNeeded(): void {
  if (memoryStore.size < memoryStoreLimit) return;
  const oldest = memoryStore.keys().next().value;
  if (oldest !== undefined) memoryStore.delete(oldest);
}

function pruneExpiredMemoryEntries(now: number): void {
  for (const [key, entry] of memoryStore) {
    if (entry.expiry <= now) memoryStore.delete(key);
  }
}

/** Persist a fresh flow state (creation side). Best-effort silent false. */
export async function storeTelegramOidcState(
  state: string,
  value: TelegramOidcStateValue,
  ttlSec: number = TELEGRAM_OIDC_STATE_TTL_SEC,
): Promise<boolean> {
  const redis = getRedisClient();
  if (redis) {
    try {
      const result = await withRedisCommandTimeout(
        "tg_oidc_state_set",
        () => redis.set(`tg-oidc:state:${state}`, JSON.stringify(value), { EX: ttlSec }),
        1_000,
      );
      return result === "OK";
    } catch (err) {
      logger.warn(
        { category: "auth", err: err instanceof Error ? err.message : String(err) },
        "[telegram-oidc-state] Redis set failed — falling back to in-memory store",
      );
    }
  }
  const now = Date.now();
  if (memoryStore.size >= memoryStoreLimit / 10) pruneExpiredMemoryEntries(now);
  evictMemoryIfNeeded();
  memoryStore.set(state, { value, expiry: now + ttlSec * 1000 });
  return true;
}

/**
 * Consume the flow state (callback side) — EXACTLY once. A second read of
 * the same state (double callback delivery, replayed redirect) finds
 * nothing and the login fails closed.
 */
export async function consumeTelegramOidcState(
  state: string,
): Promise<TelegramOidcStateValue | null> {
  const redis = getRedisClient();
  if (redis) {
    try {
      const raw = await withRedisCommandTimeout(
        "tg_oidc_state_getdel",
        () => redis.getDel(`tg-oidc:state:${state}`),
        1_000,
      );
      if (typeof raw !== "string" || raw.length === 0) return null;
      return parseStateValue(raw);
    } catch (err) {
      logger.warn(
        { category: "auth", err: err instanceof Error ? err.message : String(err) },
        "[telegram-oidc-state] Redis consume failed — falling back to in-memory store",
      );
    }
  }
  const entry = memoryStore.get(state);
  if (!entry) return null;
  memoryStore.delete(state);
  if (entry.expiry <= Date.now()) return null;
  return entry.value;
}

function parseStateValue(raw: string): TelegramOidcStateValue | null {
  try {
    const parsed = JSON.parse(raw) as Partial<TelegramOidcStateValue>;
    if (
      typeof parsed.verifier !== "string" ||
      typeof parsed.nonce !== "string" ||
      typeof parsed.createdAt !== "number"
    ) {
      return null;
    }
    return {
      verifier: parsed.verifier,
      nonce: parsed.nonce,
      redirect: typeof parsed.redirect === "string" ? parsed.redirect : null,
      referralCode: typeof parsed.referralCode === "string" ? parsed.referralCode : null,
      // R191: pre-native Redis entries (mid-rollout) carry no flag → web.
      native: parsed.native === true,
      createdAt: parsed.createdAt,
    };
  } catch {
    return null;
  }
}

/** Test-only hooks: isolate + shrink the memory store between cases. */
export const __test = {
  resetMemoryStore(): void {
    memoryStore.clear();
  },
  setMemoryStoreLimit(limit: number): number {
    const previous = memoryStoreLimit;
    memoryStoreLimit = limit;
    return previous;
  },
  memoryStoreSize(): number {
    return memoryStore.size;
  },
};
