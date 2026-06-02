/**
 * Risk-scoring orchestration (T010).
 *
 * The single entry point for the risk pipeline. Composes:
 *   1. The rules engine (T009).
 *   2. The cached risk_config + allowlist consultation (T037).
 *   3. The Phase-1 confidence formula (research.md §9).
 *   4. Per-user aggregated trend (T010a).
 *   5. Persistence to `risk_events` when
 *      `RISK_PIPELINE_ENABLED=true`.
 *
 * Failure mode: any internal error (DB down, Redis down, rule
 * exception) falls back to rules-only with a Sentry warning
 * per spec §1 Edge Cases / FR-010 / research.md §1. The caller
 * always gets a usable result; the pipeline never throws.
 */

import { db, riskEventsTable, type NewRiskEvent } from "@workspace/db";

import { logger } from "../lib/logger";
import { getUserAggregatedRiskScore, invalidateUserAggregate } from "../lib/risk-aggregate";
import {
  recordEventScored,
  recordPipelineFallback,
  recordScoringDuration,
} from "../lib/risk-metrics";
import {
  deriveLevel,
  getRiskConfig,
  isAllowlisted,
  type RiskConfigSnapshot,
} from "./risk-config-cache.service";
import { evaluateRules, type RuleContext } from "./risk-rules.service";

const PIPELINE_DEGRADED_KEY = "risk:pipeline:degraded";

export interface ScoringInput {
  eventType: NewRiskEvent["eventType"];
  userId?: number | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  device?: string | null;
  phone?: string | null;
  /** Free-form context for rule evaluation. */
  ruleContext: RuleContext;
}

export interface ScoringResult {
  /** 0-100, integer. */
  score: number;
  level: "low" | "medium" | "high" | "critical";
  /** 0.0-1.0. */
  confidence: number;
  ruleFired: string[];
  actionTaken: NewRiskEvent["actionTaken"];
  /** Persisted row id, or null if persistence skipped/failed. */
  riskEventId: number | null;
  /** True iff the pipeline degraded to rules-only on this call. */
  degraded: boolean;
}

export function isPipelineEnabled(): boolean {
  return process.env.RISK_PIPELINE_ENABLED === "true";
}

/**
 * Score one event and (when enabled) persist a row to
 * `risk_events`. Always returns a usable result — never
 * throws on internal failure. Callers should not block their
 * own request path on the persistence side-effects.
 */
export async function scoreEvent(input: ScoringInput): Promise<ScoringResult> {
  const startedAt = process.hrtime.bigint();
  let degraded = false;

  let config: RiskConfigSnapshot;
  try {
    config = await getRiskConfig();
  } catch (err) {
    logger.warn(
      { err, category: "risk-scoring" },
      "[risk-scoring] config read failed; using snapshot defaults",
    );
    recordPipelineFallback("config_read");
    degraded = true;
    config = {
      thresholds: { low: 0, medium: 30, high: 60, critical: 85 },
      allowlist: { ips: [], devices: [], phones: [] },
      autoBlockEnabled: { softBlock: true, hardBlock: false, alert: true },
      requireApprovalUserIds: [],
      modelEnabled: false,
    };
  }

  let ruleFired: string[] = [];
  let scoreDelta = 0;
  try {
    const evald = await evaluateRules(input.ruleContext);
    ruleFired = evald.ruleFired;
    scoreDelta = evald.scoreDelta;
    if (evald.errors.length > 0) {
      logger.warn(
        { errors: evald.errors, category: "risk-scoring" },
        "[risk-scoring] some rules errored; ignored",
      );
    }
  } catch (err) {
    logger.error({ err, category: "risk-scoring" }, "[risk-scoring] rule engine threw");
    recordPipelineFallback("rule_engine");
    degraded = true;
  }

  // Per-user aggregated trend folds into the score (small
  // weight — 20% of the user's recent baseline) per spec §5.4.
  let userTrend = 0;
  if (typeof input.userId === "number" && input.userId > 0) {
    try {
      userTrend = await getUserAggregatedRiskScore(input.userId);
    } catch {
      userTrend = 0;
    }
  }

  const score = Math.max(0, Math.min(100, Math.round(scoreDelta + 0.2 * userTrend)));
  const level = deriveLevel(score, config.thresholds);

  // Phase-1 confidence formula per research.md §9:
  // confidence = clamp(0.5 + 0.1 * rulesFired, 0.5, 1.0)
  // (Phase 2 will overlay statistical-signal agreement.)
  const confidence = Math.max(0.5, Math.min(1.0, 0.5 + 0.1 * ruleFired.length));

  // Allowlist consultation per spec §5.4 — never block an
  // allowlisted source. Log only.
  const allowlisted = isAllowlisted(
    {
      ip: input.ipAddress ?? null,
      device: input.device ?? null,
      phone: input.phone ?? null,
    },
    config.allowlist,
  );

  const actionTaken: NewRiskEvent["actionTaken"] = decideAction({
    level,
    confidence,
    allowlisted,
    autoBlockEnabled: config.autoBlockEnabled,
    modelEnabled: config.modelEnabled,
  });

  // Persist when enabled. Persistence failure does not change
  // the in-memory result; caller can still act on score/level.
  let riskEventId: number | null = null;
  if (isPipelineEnabled()) {
    try {
      const inserted = await db
        .insert(riskEventsTable)
        .values({
          userId: input.userId ?? null,
          eventType: input.eventType,
          score,
          level,
          confidence: confidence.toFixed(3),
          ruleFired,
          statisticalSignals: {},
          mlScore: null,
          topFeatures: null,
          actionTaken,
          ipAddress: input.ipAddress ?? null,
          userAgent: (input.userAgent ?? "").slice(0, 256) || null,
        })
        .returning({ id: riskEventsTable.id });
      riskEventId = inserted[0]?.id ?? null;
      if (typeof input.userId === "number" && input.userId > 0) {
        await invalidateUserAggregate(input.userId);
      }
    } catch (err) {
      logger.warn(
        { err, category: "risk-scoring" },
        "[risk-scoring] persist failed; degraded to rules-only",
      );
      recordPipelineFallback("persist");
      degraded = true;
      await markPipelineDegraded();
    }
  }

  // Metrics.
  const durationSec = Number(process.hrtime.bigint() - startedAt) / 1e9;
  recordScoringDuration(input.eventType, durationSec);
  recordEventScored(input.eventType, level);

  return {
    score,
    level,
    confidence,
    ruleFired,
    actionTaken,
    riskEventId,
    degraded,
  };
}

interface DecideActionInput {
  level: "low" | "medium" | "high" | "critical";
  confidence: number;
  allowlisted: boolean;
  autoBlockEnabled: { softBlock: boolean; hardBlock: boolean; alert: boolean };
  modelEnabled: boolean;
}

function decideAction(input: DecideActionInput): NewRiskEvent["actionTaken"] {
  if (input.allowlisted) return "log";
  if (input.level === "critical") {
    // Hard-block is gated on Phase-3 modelEnabled per data-model §3.
    if (input.autoBlockEnabled.hardBlock && input.modelEnabled) return "hard_block";
    return "alert";
  }
  if (input.level === "high") {
    if (input.autoBlockEnabled.softBlock && input.confidence >= 0.7) return "soft_block";
    return "alert";
  }
  if (input.level === "medium") return "alert";
  return "log";
}

async function markPipelineDegraded(): Promise<void> {
  try {
    const { getRedisClient } = await import("../lib/redis-client");
    const redis = getRedisClient();
    if (redis) {
      // 5-min TTL — if degradation clears, the flag self-resets.
      await redis.set(PIPELINE_DEGRADED_KEY, "1", { EX: 300 });
    }
  } catch {
    // best-effort
  }
}
