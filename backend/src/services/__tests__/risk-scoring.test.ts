import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db, execTestSql, initTestDb, resetTestDb, usersTable } from "../../test/db";
import { riskEventsTable, riskRulesTable } from "@workspace/db";
import { scoreEvent, type ScoringResult } from "../risk-scoring.service";
import { evaluateRules } from "../risk-rules.service";
import { invalidateRiskConfig } from "../risk-config-cache.service";
import { invalidateRulesCache } from "../risk-rules.service";

/**
 * R118-A5 TOP-20 #10 [P2] — the risk scoring trio
 * (risk-rules.service.ts / risk-scoring.service.ts /
 * risk-config-cache.service.ts) had ZERO test imports (A5 §3).
 *
 * Pinned contracts (services are DB-backed with cache seams, so this is
 * the honest injectable version of the sketch — rules + config are
 * seeded through the real tables and the exported cache-invalidation
 * hooks are the seams):
 *
 *   1. a benign pattern does NOT score (0 rules fired → score 0, level
 *      low, action log) and the score is bounded + monotonic in rule
 *      severity (0 → 40 → 90 → capped 100);
 *   2. crossing the threshold changes the verdict — including the
 *      hard_block action consumed by middlewares/risk-hard-block.ts
 *      (critical + modelEnabled + hardBlock gates), the
 *      confidence-gated soft_block (high + ≥0.7), and the allowlist
 *      short-circuit (log, never block);
 *   3. risk-config cache invalidation changes the verdict on the next
 *      call — the same 40-score event is medium under the default
 *      thresholds and critical after the operator tightens
 *      thresholds.critical to 30 + invalidateRiskConfig();
 *   4. with RISK_PIPELINE_ENABLED=true the result is persisted to
 *      risk_events (riskEventId non-null; row shape matches).
 *
 * DSL note: rules are {type:"and"|"or", clauses:[{field, operator,
 * value}], score_delta} — lib/risk-dsl.ts validates shape; unknown
 * fields evaluate to undefined and never fire.
 */

const RISK_DDL = `
CREATE TYPE risk_event_type AS ENUM (
  'login_attempt','login_success','login_failure','otp_request','otp_verify',
  'topup_attempt','topup_success','order_create','order_deliver','coupon_apply',
  'referral_event','admin_force_reauth');
CREATE TYPE risk_level AS ENUM ('low','medium','high','critical');
CREATE TYPE risk_action_taken AS ENUM ('none','log','soft_block','hard_block','alert');
CREATE TABLE risk_events (
  id serial PRIMARY KEY,
  user_id integer REFERENCES users(id) ON DELETE SET NULL,
  event_type risk_event_type NOT NULL,
  score integer NOT NULL,
  level risk_level NOT NULL,
  confidence numeric(4,3) NOT NULL,
  rule_fired text[] NOT NULL DEFAULT '{}',
  statistical_signals jsonb NOT NULL DEFAULT '{}',
  ml_score numeric(4,3),
  top_features jsonb,
  action_taken risk_action_taken NOT NULL DEFAULT 'log',
  ip_address varchar(45),
  user_agent varchar(256),
  created_at timestamptz NOT NULL DEFAULT now(),
  shown_at timestamptz
);
CREATE TABLE risk_config (
  id integer PRIMARY KEY DEFAULT 1,
  thresholds jsonb NOT NULL,
  allowlist jsonb NOT NULL,
  auto_block_enabled jsonb NOT NULL,
  require_approval_user_ids jsonb NOT NULL DEFAULT '[]',
  model_enabled boolean NOT NULL DEFAULT false,
  updated_by integer,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE risk_rules (
  id serial PRIMARY KEY,
  name varchar(100) NOT NULL UNIQUE,
  description text NOT NULL,
  expression jsonb NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_by integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by integer,
  updated_at timestamptz NOT NULL DEFAULT now()
);
`;

interface SeededRule {
  name: string;
  scoreDelta: number;
}

/** Seed the two Phase-1-style hard-threshold rules. */
async function seedStandardRules(): Promise<void> {
  await db.insert(riskRulesTable).values([
    {
      name: "failed_logins_v1",
      description: "≥3 failed logins recently",
      expression: {
        type: "and",
        clauses: [{ field: "user.recentFailedLogins", operator: "gte", value: 3 }],
        score_delta: 40,
      },
      enabled: true,
    },
    {
      name: "new_account_big_topup_v1",
      description: "day-old account moving ≥200",
      expression: {
        type: "and",
        clauses: [
          { field: "user.accountAgeDays", operator: "lte", value: 1 },
          { field: "event.amount", operator: "gte", value: 200 },
        ],
        score_delta: 50,
      },
      enabled: true,
    },
  ]);
  invalidateRulesCache();
}

async function seedRule(name: string, scoreDelta: number, clauses: unknown[]): Promise<void> {
  await db.insert(riskRulesTable).values({
    name,
    description: `${name} fixture`,
    expression: { type: "and", clauses, score_delta: scoreDelta },
    enabled: true,
  });
  invalidateRulesCache();
}

function benignContext() {
  return {
    eventType: "login_success" as const,
    ruleContext: {
      event: { eventType: "login_success", ipAddress: "198.51.100.10" },
      user: { id: undefined, accountAgeDays: 400, recentFailedLogins: 0 },
    },
  };
}

function suspiciousContext(recentFailedLogins = 3, amount = 10, accountAgeDays = 400) {
  return {
    eventType: "login_success" as const,
    ruleContext: {
      event: { eventType: "login_success", ipAddress: "198.51.100.10", amount },
      user: { id: undefined, accountAgeDays, recentFailedLogins },
    },
  };
}

async function seedConfig(patch: {
  thresholds?: { low: number; medium: number; high: number; critical: number };
  allowlist?: { ips: string[]; devices: string[]; phones: string[] };
  autoBlockEnabled?: { softBlock: boolean; hardBlock: boolean; alert: boolean };
  modelEnabled?: boolean;
}): Promise<void> {
  await db.execute(sql`
    INSERT INTO risk_config (id, thresholds, allowlist, auto_block_enabled, model_enabled)
    VALUES (1,
      ${JSON.stringify(patch.thresholds ?? { low: 0, medium: 30, high: 60, critical: 85 })}::jsonb,
      ${JSON.stringify(patch.allowlist ?? { ips: [], devices: [], phones: [] })}::jsonb,
      ${JSON.stringify(patch.autoBlockEnabled ?? { softBlock: true, hardBlock: false, alert: true })}::jsonb,
      ${patch.modelEnabled ?? false})
    ON CONFLICT (id) DO UPDATE SET
      thresholds = EXCLUDED.thresholds,
      allowlist = EXCLUDED.allowlist,
      auto_block_enabled = EXCLUDED.auto_block_enabled,
      model_enabled = EXCLUDED.model_enabled
  `);
  await invalidateRiskConfig();
}

beforeAll(async () => {
  await initTestDb();
  await execTestSql(RISK_DDL);
});

afterAll(() => {
  delete process.env.RISK_PIPELINE_ENABLED;
});

beforeEach(async () => {
  await resetTestDb();
  await db.execute(sql.raw("TRUNCATE risk_events, risk_config, risk_rules RESTART IDENTITY"));
  invalidateRulesCache();
  await invalidateRiskConfig();
  delete process.env.RISK_PIPELINE_ENABLED;
});

describe("scoreEvent — bounded, monotonic, benign-clean (R118-A5 #10)", () => {
  it("a benign pattern does NOT score: 0 rules fired, score 0, level low, action log", async () => {
    await seedStandardRules();
    const result = await scoreEvent(benignContext());
    expect(result).toMatchObject({
      score: 0,
      level: "low",
      actionTaken: "log",
      ruleFired: [],
      degraded: false,
    });
    // Pipeline disabled (default production shape) → nothing persisted.
    expect(result.riskEventId).toBeNull();
  });

  it("the score is monotonic in event severity and bounded at 100", async () => {
    await seedStandardRules();
    // 1 rule fired (40) → medium.
    const one = await scoreEvent(suspiciousContext(3, 10));
    expect(one.score).toBe(40);
    expect(one.level).toBe("medium");
    // 2 rules fired (40 + 50 = 90) → critical.
    const two = await scoreEvent(suspiciousContext(3, 250, 1));
    expect(two.score).toBe(90);
    expect(two.level).toBe("critical");
    expect(two.ruleFired).toEqual(
      expect.arrayContaining(["failed_logins_v1", "new_account_big_topup_v1"]),
    );

    // Bounded: two max-delta rules cap at 100 — never above.
    await seedRule("max_a", 100, [
      { field: "user.recentFailedLogins", operator: "gte", value: 1 },
    ]);
    await seedRule("max_b", 100, [
      { field: "user.recentFailedLogins", operator: "gte", value: 2 },
    ]);
    const capped = await scoreEvent(suspiciousContext(5, 10));
    expect(capped.score).toBe(100);
    expect(capped.score).toBeLessThanOrEqual(100);
    expect(capped.level).toBe("critical");
  });

  it("the rules engine caps the CUMULATIVE delta at 100 before scoring sees it", async () => {
    await seedRule("cap_a", 80, [{ field: "user.recentFailedLogins", operator: "gte", value: 1 }]);
    await seedRule("cap_b", 80, [{ field: "user.recentFailedLogins", operator: "gte", value: 2 }]);
    const evald = await evaluateRules(suspiciousContext(5, 10).ruleContext);
    expect(evald.scoreDelta).toBe(100); // 80 + 80 → capped
    expect(evald.ruleFired).toEqual(["cap_a", "cap_b"]);
  });
});

describe("scoreEvent — threshold verdicts incl. hard_block (R118-A5 #10)", () => {
  it("critical + modelEnabled + hardBlock gates → the hard_block verdict consumed by risk-hard-block.ts", async () => {
    await seedStandardRules();
    // Both gates ON — the only shape decideAction emits hard_block for.
    await seedConfig({ modelEnabled: true, autoBlockEnabled: { softBlock: true, hardBlock: true, alert: true } });
    const result = await scoreEvent(suspiciousContext(3, 250, 1)); // 90 → critical
    expect(result).toMatchObject({ score: 90, level: "critical", actionTaken: "hard_block" });
  });

  it("critical with the model gate OFF (production default) → alert, NOT hard_block", async () => {
    await seedStandardRules();
    // autoBlockEnabled.hardBlock=true but modelEnabled=false (Phase-3 gate).
    await seedConfig({ modelEnabled: false, autoBlockEnabled: { softBlock: true, hardBlock: true, alert: true } });
    const result = await scoreEvent(suspiciousContext(3, 250, 1));
    expect(result.level).toBe("critical");
    expect(result.actionTaken).toBe("alert");
  });

  it("high + confidence ≥ 0.7 (2 rules) → soft_block; high + confidence 0.6 (1 rule) → alert only", async () => {
    // A high-band score via a single rule is impossible with the standard
    // pair (40 or 90) — seed ONLY a 65-delta rule for the band.
    await seedRule("mid_band_65", 65, [
      { field: "user.recentFailedLogins", operator: "gte", value: 3 },
    ]);
    // One rule fired → confidence = 0.5 + 0.1×1 = 0.6 < 0.7 → alert.
    const lowConfidence = await scoreEvent(suspiciousContext(3, 10));
    expect(lowConfidence.score).toBe(65);
    expect(lowConfidence.level).toBe("high");
    expect(lowConfidence.confidence).toBeCloseTo(0.6, 5);
    expect(lowConfidence.actionTaken).toBe("alert");

    // Two rules (65 + 40 = 100... that is critical) — use 65 + a 10-delta
    // companion for a 75 high-band score with 2 rules → confidence 0.7.
    await seedRule("companion_10", 10, [
      { field: "user.recentFailedLogins", operator: "gte", value: 4 },
    ]);
    const highConfidence = await scoreEvent(suspiciousContext(5, 10));
    expect(highConfidence.score).toBe(75);
    expect(highConfidence.level).toBe("high");
    expect(highConfidence.confidence).toBeCloseTo(0.7, 5);
    expect(highConfidence.actionTaken).toBe("soft_block");
  });

  it("an allowlisted source NEVER blocks — even a critical event stays log (spec §5.4)", async () => {
    await seedStandardRules();
    await seedConfig({
      modelEnabled: true,
      allowlist: { ips: ["203.0.113.9"], devices: [], phones: [] },
      autoBlockEnabled: { softBlock: true, hardBlock: true, alert: true },
    });
    const result = await scoreEvent({
      eventType: "login_success",
      ipAddress: "203.0.113.9",
      ruleContext: {
        event: { eventType: "login_success", ipAddress: "203.0.113.9", amount: 250 },
        user: { id: undefined, accountAgeDays: 1, recentFailedLogins: 3 },
      },
    });
    expect(result.score).toBe(90);
    expect(result.level).toBe("critical");
    expect(result.actionTaken).toBe("log");
  });
});

describe("risk-config cache invalidation changes the verdict (R118-A5 #10)", () => {
  it("the same 40-score event: medium under defaults → critical after thresholds tighten + invalidateRiskConfig()", async () => {
    await seedRule("fixed_40", 40, [
      { field: "user.recentFailedLogins", operator: "gte", value: 3 },
    ]);

    // First call — no risk_config row: getRiskConfig auto-seeds the
    // DEFAULT thresholds (0/30/60/85). 40 lands in the medium band.
    const before = await scoreEvent(suspiciousContext(3, 10));
    expect(before).toMatchObject({ score: 40, level: "medium", actionTaken: "alert" });

    // The operator tightens critical to 30 — WITHOUT invalidation the
    // 60 s cache would keep serving the stale verdict.
    await seedConfig({ thresholds: { low: 0, medium: 10, high: 20, critical: 30 } });

    const after = await scoreEvent(suspiciousContext(3, 10));
    expect(after).toMatchObject({ score: 40, level: "critical", actionTaken: "alert" });
  });
});

describe("persistence (RISK_PIPELINE_ENABLED=true) (R118-A5 #10)", () => {
  it("persists the scored event with the computed verdict and returns the row id", async () => {
    process.env.RISK_PIPELINE_ENABLED = "true";
    const [user] = await db
      .insert(usersTable)
      .values({ phone: "950000001" })
      .returning();
    await seedRule("fixed_40", 40, [
      { field: "user.recentFailedLogins", operator: "gte", value: 3 },
    ]);

    const result: ScoringResult = await scoreEvent({
      eventType: "login_failure",
      userId: user.id,
      ipAddress: "198.51.100.77",
      userAgent: "vitest/1.0",
      ruleContext: {
        event: { eventType: "login_failure", ipAddress: "198.51.100.77" },
        user: { id: user.id, recentFailedLogins: 4 },
      },
    });

    expect(result.riskEventId).not.toBeNull();
    const [row] = await db
      .select()
      .from(riskEventsTable)
      .where(eq(riskEventsTable.id, result.riskEventId!));
    expect(row).toMatchObject({
      userId: user.id,
      eventType: "login_failure",
      score: 40,
      level: "medium",
      actionTaken: "alert",
      ipAddress: "198.51.100.77",
    });
    expect(row.ruleFired).toEqual(["fixed_40"]);
    expect(String(row.confidence)).toMatch(/^0\.6/);
  });

  it("a disabled rule never fires (the enabled flag is the operator's kill switch)", async () => {
    await seedRule("disabled_rule", 90, [
      { field: "user.recentFailedLogins", operator: "gte", value: 0 },
    ]);
    await db
      .update(riskRulesTable)
      .set({ enabled: false })
      .where(eq(riskRulesTable.name, "disabled_rule"));
    invalidateRulesCache();

    const result = await scoreEvent(suspiciousContext(5, 10));
    expect(result.score).toBe(0);
    expect(result.ruleFired).toEqual([]);
  });
});
