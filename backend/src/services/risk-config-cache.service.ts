/**
 * risk-config singleton cache (T037).
 *
 * Reads `risk_config` once per request via a Redis cache-aside.
 * The cache is invalidated on PUT (T035) via Redis pub/sub on
 * the `risk_config_invalidated` channel — so admin threshold
 * changes take effect within ~50ms (US3 acceptance scenario).
 *
 * Falls back to safe defaults if Redis or Postgres is
 * unavailable, preserving the spec's safe-by-default posture
 * (FR-010 + spec §1 Edge Cases). Defaults match
 * `data-model.md` §3 (low/medium/high/critical = 0/30/60/85).
 */

import { db, riskConfigTable, type RiskConfig } from "@workspace/db";
import { eq } from "drizzle-orm";

import { logger } from "../lib/logger";
import { getRedisClient } from "../lib/redis-client";

const CACHE_KEY = "risk:config:singleton";
const CACHE_TTL_SECONDS = 60;
const INVALIDATION_CHANNEL = "risk_config_invalidated";

const SINGLETON_ID = 1;

interface RiskConfigDefaults {
  thresholds: { low: number; medium: number; high: number; critical: number };
  allowlist: { ips: string[]; devices: string[]; phones: string[] };
  autoBlockEnabled: { softBlock: boolean; hardBlock: boolean; alert: boolean };
  requireApprovalUserIds: number[];
  modelEnabled: boolean;
}

const DEFAULTS: RiskConfigDefaults = {
  thresholds: { low: 0, medium: 30, high: 60, critical: 85 },
  allowlist: { ips: [], devices: [], phones: [] },
  autoBlockEnabled: { softBlock: true, hardBlock: false, alert: true },
  requireApprovalUserIds: [],
  modelEnabled: false,
};

let inMemoryCache: RiskConfig | null = null;
let inMemoryCacheExpiresAt = 0;
let invalidationSubscribed = false;

export interface RiskConfigSnapshot {
  thresholds: { low: number; medium: number; high: number; critical: number };
  allowlist: { ips: string[]; devices: string[]; phones: string[] };
  autoBlockEnabled: { softBlock: boolean; hardBlock: boolean; alert: boolean };
  requireApprovalUserIds: number[];
  modelEnabled: boolean;
}

/**
 * Read the (cached) singleton risk config. Always returns a
 * usable snapshot — defaults are baked in for the failure
 * paths so the scoring service never blocks on a config read.
 */
export async function getRiskConfig(): Promise<RiskConfigSnapshot> {
  const now = Date.now();
  if (inMemoryCache && now < inMemoryCacheExpiresAt) {
    return toSnapshot(inMemoryCache);
  }

  await ensureInvalidationSubscription();

  // Redis read-through (best-effort).
  try {
    const redis = getRedisClient();
    if (redis) {
      const raw = await redis.get(CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as RiskConfig;
        inMemoryCache = parsed;
        inMemoryCacheExpiresAt = now + CACHE_TTL_SECONDS * 1000;
        return toSnapshot(parsed);
      }
    }
  } catch (err) {
    logger.warn(
      { err, category: "risk-config" },
      "[risk-config] redis read failed; falling through to db",
    );
  }

  // Postgres read; auto-seed on first access.
  try {
    let row = await db
      .select()
      .from(riskConfigTable)
      .where(eq(riskConfigTable.id, SINGLETON_ID))
      .limit(1)
      .then((rows) => rows[0]);

    if (!row) {
      const inserted = await db
        .insert(riskConfigTable)
        .values({ id: SINGLETON_ID, ...DEFAULTS })
        .onConflictDoNothing()
        .returning();
      row =
        inserted[0] ??
        (await db
          .select()
          .from(riskConfigTable)
          .where(eq(riskConfigTable.id, SINGLETON_ID))
          .limit(1)
          .then((rows) => rows[0]));
    }

    if (row) {
      inMemoryCache = row;
      inMemoryCacheExpiresAt = now + CACHE_TTL_SECONDS * 1000;
      try {
        const redis = getRedisClient();
        if (redis) {
          await redis.set(CACHE_KEY, JSON.stringify(row), { EX: CACHE_TTL_SECONDS });
        }
      } catch {
        // best-effort cache populate
      }
      return toSnapshot(row);
    }
  } catch (err) {
    logger.warn(
      { err, category: "risk-config" },
      "[risk-config] db read failed; using safe defaults",
    );
  }

  return defaultSnapshot();
}

/**
 * Invalidate the cache (call from `PUT /api/admin/risk/config`
 * after the row update completes). Publishes on the Redis
 * channel so other web/worker processes evict their in-memory
 * caches too.
 */
export async function invalidateRiskConfig(): Promise<void> {
  inMemoryCache = null;
  inMemoryCacheExpiresAt = 0;
  try {
    const redis = getRedisClient();
    if (redis) {
      await redis.del(CACHE_KEY);
      await redis.publish(INVALIDATION_CHANNEL, "1");
    }
  } catch (err) {
    logger.warn({ err, category: "risk-config" }, "[risk-config] redis invalidate publish failed");
  }
}

async function ensureInvalidationSubscription(): Promise<void> {
  if (invalidationSubscribed) return;
  try {
    const redis = getRedisClient();
    if (!redis) return;
    // node-redis v4: duplicate then connect; SUBSCRIBE requires
    // a dedicated connection (the main one cannot mix commands).
    const sub = redis.duplicate();
    await sub.connect();
    await sub.subscribe(INVALIDATION_CHANNEL, () => {
      inMemoryCache = null;
      inMemoryCacheExpiresAt = 0;
    });
    invalidationSubscribed = true;
  } catch (err) {
    logger.warn(
      { err, category: "risk-config" },
      "[risk-config] redis pub/sub unavailable; cache will still TTL out",
    );
  }
}

function toSnapshot(row: RiskConfig): RiskConfigSnapshot {
  return {
    thresholds: (row.thresholds as RiskConfigSnapshot["thresholds"]) ?? DEFAULTS.thresholds,
    allowlist: (row.allowlist as RiskConfigSnapshot["allowlist"]) ?? DEFAULTS.allowlist,
    autoBlockEnabled:
      (row.autoBlockEnabled as RiskConfigSnapshot["autoBlockEnabled"]) ?? DEFAULTS.autoBlockEnabled,
    requireApprovalUserIds:
      (row.requireApprovalUserIds as number[]) ?? DEFAULTS.requireApprovalUserIds,
    modelEnabled: row.modelEnabled,
  };
}

function defaultSnapshot(): RiskConfigSnapshot {
  return {
    thresholds: { ...DEFAULTS.thresholds },
    allowlist: {
      ips: [...DEFAULTS.allowlist.ips],
      devices: [...DEFAULTS.allowlist.devices],
      phones: [...DEFAULTS.allowlist.phones],
    },
    autoBlockEnabled: { ...DEFAULTS.autoBlockEnabled },
    requireApprovalUserIds: [...DEFAULTS.requireApprovalUserIds],
    modelEnabled: DEFAULTS.modelEnabled,
  };
}

/**
 * Pure helper: derive the level from a numeric score using
 * the supplied thresholds. Lower-bound semantics — `medium`
 * starts at `thresholds.medium` (inclusive). Used by the
 * scoring service in T010.
 */
export function deriveLevel(
  score: number,
  thresholds: RiskConfigSnapshot["thresholds"],
): "low" | "medium" | "high" | "critical" {
  if (score >= thresholds.critical) return "critical";
  if (score >= thresholds.high) return "high";
  if (score >= thresholds.medium) return "medium";
  return "low";
}

/**
 * Allowlist consultation per spec §5.4 + Constitution IV.
 * Returns true if the request's identifying signal matches
 * any entry — caller must short-circuit `actionTaken` to
 * `log` and skip soft/hard block.
 */
export function isAllowlisted(
  signal: { ip?: string | null; device?: string | null; phone?: string | null },
  allowlist: RiskConfigSnapshot["allowlist"],
): boolean {
  if (signal.ip && allowlist.ips.includes(signal.ip)) return true;
  if (signal.device && allowlist.devices.includes(signal.device)) return true;
  if (signal.phone && allowlist.phones.includes(signal.phone)) return true;
  return false;
}
