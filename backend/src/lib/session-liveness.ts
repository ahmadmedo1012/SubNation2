import { and, eq, gte } from "drizzle-orm";
import { db, sessionsTable } from "@workspace/db";

/**
 * Shared session-row liveness probe.
 *
 * Extracted verbatim from `middlewares/requireUser.ts` (H1, deep-audit
 * 2026-09-06) so the Socket.IO handshake gate (lib/socket.ts, 93-A1 S1)
 * and `GET /api/auth/probe` (routes/auth.ts, 93-A1 S2) use the IDENTICAL
 * revocation semantics + in-process TTL cache as every HTTP request
 * that flows through `requireUser`.
 *
 * Semantics (unchanged from requireUser):
 *   - A session row is "live" when it EXISTS and expires_at >= now.
 *   - A tiny in-process TTL cache keeps this off the hot path: each
 *     session costs at most one DB probe per 60 s per instance.
 *     Revocation therefore propagates within ≤ 60 s + cache lifetime —
 *     an explicit, documented trade-off vs. per-request queries on a
 *     single shared Postgres pool.
 */
const SESSION_CACHE_TTL_MS = 60_000;
const sessionValidityCache = new Map<string, number>();

let cachePruneCounter = 0;
function pruneValidityCache(): void {
  // Cheap opportunistic prune — no interval timer, no unbounded growth.
  if (++cachePruneCounter % 500 !== 0) return;
  const now = Date.now();
  for (const [key, expiry] of sessionValidityCache) {
    if (expiry < now) sessionValidityCache.delete(key);
  }
}

export async function isSessionRowLive(sessionId: string): Promise<boolean> {
  const now = Date.now();
  const cachedUntil = sessionValidityCache.get(sessionId);
  if (cachedUntil !== undefined && cachedUntil > now) return true;

  const rows = await db
    .select({ id: sessionsTable.id })
    .from(sessionsTable)
    .where(and(eq(sessionsTable.id, sessionId), gte(sessionsTable.expiresAt, new Date(now))))
    .limit(1);

  if (rows.length > 0) {
    sessionValidityCache.set(sessionId, now + SESSION_CACHE_TTL_MS);
    pruneValidityCache();
    return true;
  }
  return false;
}

/** Test-only hook: drop the 60 s cache so the next probe hits the DB. */
export function __clearSessionValidityCacheForTests(): void {
  sessionValidityCache.clear();
  cachePruneCounter = 0;
}
