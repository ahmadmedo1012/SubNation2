/**
 * Risk-rules service (T009).
 *
 * Loads enabled rules from `risk_rules`, evaluates them
 * against a scoring context, and returns the names of those
 * that fired plus their cumulative score delta. The DSL
 * (`backend/src/lib/risk-dsl.ts`) is the only allowed
 * expression form — buggy / arbitrary code cannot reach
 * here per Constitution IV (auditable, narrow operator set).
 *
 * Phase 1 ships with hard-threshold rules from T015. Phase 2
 * adds statistical signals via the separate
 * `risk-statistical.service.ts` (T048).
 */

import { db, riskRulesTable, type RiskRule } from "@workspace/db";
import { eq } from "drizzle-orm";

import { logger } from "../lib/logger";
import { recordRuleFired } from "../lib/risk-metrics";
import { evalClause, parseDsl, type DslClause, type DslExpression } from "../lib/risk-dsl";

/**
 * The minimum fields the scoring context must expose for the
 * rules to evaluate. Additional fields can be added freely —
 * unknown fields evaluate to `undefined` and never throw.
 */
export interface RuleContext {
  event: {
    eventType: string;
    ipAddress?: string | null;
    userAgent?: string | null;
    amount?: number;
    country?: string | null;
  };
  user?: {
    id?: number;
    accountAgeDays?: number;
    lifetimeTopupCount?: number;
    averageTopupAmount?: number;
    recentFailedLogins?: number;
    recentOtpRequests?: number;
    recentTopupAmount?: number;
    distinctCountriesLast30d?: number;
    lastCountry?: string | null;
    [k: string]: unknown;
  };
}

export interface RuleEvaluationResult {
  /** Rule names that fired. */
  ruleFired: string[];
  /** Cumulative score contribution; sum of `score_delta` across fired rules, capped at 100. */
  scoreDelta: number;
  /** Errors encountered while evaluating individual rules (best-effort). */
  errors: Array<{ ruleName: string; reason: string }>;
}

const EMPTY_RESULT: RuleEvaluationResult = {
  ruleFired: [],
  scoreDelta: 0,
  errors: [],
};

let cachedRules: RiskRule[] | null = null;
let cachedAt = 0;
const RULE_CACHE_TTL_MS = 30_000;

async function loadEnabledRules(): Promise<RiskRule[]> {
  const now = Date.now();
  if (cachedRules && now - cachedAt < RULE_CACHE_TTL_MS) {
    return cachedRules;
  }
  try {
    const rows = await db.select().from(riskRulesTable).where(eq(riskRulesTable.enabled, true));
    cachedRules = rows;
    cachedAt = now;
    return rows;
  } catch (err) {
    logger.warn(
      { err, category: "risk-rules" },
      "[risk-rules] db read failed; using last cached rules (or empty)",
    );
    return cachedRules ?? [];
  }
}

/**
 * Reset the rule cache. Call from the admin route handler in
 * T033 (`PUT /api/admin/risk/rules/:id`) so a rule edit takes
 * effect on the next event without waiting for the TTL.
 */
export function invalidateRulesCache(): void {
  cachedRules = null;
  cachedAt = 0;
}

/**
 * Evaluate all enabled rules against the context. Never
 * throws — any per-rule failure is captured into `errors`
 * and the rule contributes zero to the score.
 */
export async function evaluateRules(context: RuleContext): Promise<RuleEvaluationResult> {
  const rules = await loadEnabledRules();
  if (rules.length === 0) return EMPTY_RESULT;

  const ruleFired: string[] = [];
  const errors: Array<{ ruleName: string; reason: string }> = [];
  let scoreDelta = 0;

  for (const rule of rules) {
    try {
      const parsed = parseDsl(rule.expression);
      if (!parsed.ok) {
        errors.push({ ruleName: rule.name, reason: parsed.reason });
        continue;
      }
      const fired = await evaluateExpression(parsed.expression, context);
      if (fired) {
        ruleFired.push(rule.name);
        scoreDelta += parsed.expression.score_delta;
        recordRuleFired(rule.name);
      }
    } catch (err) {
      errors.push({
        ruleName: rule.name,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    ruleFired,
    scoreDelta: Math.min(scoreDelta, 100),
    errors,
  };
}

async function evaluateExpression(expr: DslExpression, ctx: RuleContext): Promise<boolean> {
  if (expr.clauses.length === 0) return false;

  const results = await Promise.all(expr.clauses.map((c) => resolveClause(c, ctx)));

  if (expr.type === "and") {
    // 'unknown' votes are conservative-no-fire (avoid false positives on
    // missing data per Constitution IV).
    return results.every((r) => r === true);
  }
  // OR: any true fires; unknown is treated as didn't fire
  return results.some((r) => r === true);
}

async function resolveClause(clause: DslClause, ctx: RuleContext): Promise<boolean | "unknown"> {
  const v = evalClause(clause, ctx);
  if (v instanceof Promise) return v;
  return v;
}
