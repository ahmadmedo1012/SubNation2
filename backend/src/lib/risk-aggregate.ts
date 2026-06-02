/**
 * Per-user aggregated risk score (T010a — F8 from analyze).
 *
 * Computes a rolling 7-day weighted mean of recent
 * `risk_events.score` for the user, with exponential decay
 * `λ=0.1/day`. Consumed by:
 *   - T010 scoring orchestration: combines per-event score
 *     with the user trend so a user with persistent low
 *     scores is not auto-blocked on a single medium event
 *     (per spec §5.4 false-positive mitigation).
 *   - T046 dashboard `userHeatmap.aggregatedScore`.
 *
 * Cached in Redis with a 5-min TTL keyed on userId; the
 * cache is best-effort — a Redis miss falls through to
 * Postgres, a Postgres failure falls through to 0
 * (safe-by-default).
 */

import { db, riskEventsTable } from "@workspace/db";
import { and, desc, eq, gte } from "drizzle-orm";

import { logger } from "../lib/logger";
import { getRedisClient } from "../lib/redis-client";

const CACHE_TTL_SECONDS = 300;
const WINDOW_DAYS = 7;
const DECAY_LAMBDA_PER_DAY = 0.1;

function cacheKey(userId: number): string {
  return `risk:agg:user:${userId}`;
}

/**
 * Returns a 0-100 aggregated risk score for the user.
 * Returns 0 if the user has no events in the last
 * `WINDOW_DAYS` days, or if any read fails.
 */
export async function getUserAggregatedRiskScore(userId: number): Promise<number> {
  if (!Number.isFinite(userId) || userId <= 0) return 0;

  // Redis read.
  try {
    const redis = getRedisClient();
    if (redis) {
      const raw = await redis.get(cacheKey(userId));
      if (raw) {
        const parsed = Number.parseFloat(raw);
        if (Number.isFinite(parsed)) return parsed;
      }
    }
  } catch (err) {
    logger.warn(
      { err, userId, category: "risk-aggregate" },
      "[risk-aggregate] redis read failed; falling through to db",
    );
  }

  // Compute from Postgres.
  try {
    const cutoff = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const rows = await db
      .select({
        score: riskEventsTable.score,
        createdAt: riskEventsTable.createdAt,
      })
      .from(riskEventsTable)
      .where(and(eq(riskEventsTable.userId, userId), gte(riskEventsTable.createdAt, cutoff)))
      .orderBy(desc(riskEventsTable.createdAt))
      .limit(200);

    if (rows.length === 0) {
      await cachePut(userId, 0);
      return 0;
    }

    const now = Date.now();
    let weightedSum = 0;
    let weightTotal = 0;
    for (const r of rows) {
      const ageDays = (now - r.createdAt.getTime()) / (24 * 60 * 60 * 1000);
      const weight = Math.exp(-DECAY_LAMBDA_PER_DAY * ageDays);
      weightedSum += weight * r.score;
      weightTotal += weight;
    }
    const aggregated = weightTotal === 0 ? 0 : weightedSum / weightTotal;
    const clamped = Math.max(0, Math.min(100, Math.round(aggregated)));
    await cachePut(userId, clamped);
    return clamped;
  } catch (err) {
    logger.warn(
      { err, userId, category: "risk-aggregate" },
      "[risk-aggregate] db read failed; returning 0",
    );
    return 0;
  }
}

async function cachePut(userId: number, value: number): Promise<void> {
  try {
    const redis = getRedisClient();
    if (redis) {
      await redis.set(cacheKey(userId), String(value), { EX: CACHE_TTL_SECONDS });
    }
  } catch {
    // best-effort
  }
}

/**
 * Invalidate the cached aggregate for a user — called by
 * the scoring service whenever it writes a new
 * `risk_events` row for that user, so the next read sees
 * the updated value.
 */
export async function invalidateUserAggregate(userId: number): Promise<void> {
  if (!Number.isFinite(userId) || userId <= 0) return;
  try {
    const redis = getRedisClient();
    if (redis) {
      await redis.del(cacheKey(userId));
    }
  } catch {
    // best-effort
  }
}
