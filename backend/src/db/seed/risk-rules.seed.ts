/**
 * Phase-1 risk-rules seed (T015).
 *
 * Idempotent on `risk_rules.name`. Each rule stores a
 * `score_delta` in its `expression` so the synthetic
 * critical event in T044 (`new_account_large_topup_v1`
 * +60 + `impossible_travel_v1` +50 = 110, capped to 100)
 * deterministically reaches level=critical regardless of
 * admin tuning.
 *
 * Run: `pnpm tsx backend/src/db/seed/risk-rules.seed.ts`
 *
 * Statistical signals (geo, velocity, time-of-day) are NOT
 * seeded as rules — they belong in T048
 * (`risk-statistical.service.ts`). T015 ships only spec §4.1
 * hard-threshold patterns.
 */

import { db, riskRulesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

interface RuleSeed {
  name: string;
  description: string;
  expression: {
    type: "and" | "or";
    clauses: Array<{ field: string; operator: string; value: unknown }>;
    score_delta: number;
  };
}

const PHASE1_RULES: RuleSeed[] = [
  {
    name: "otp_brute_force_v1",
    description:
      "More than 5 OTP requests for the same phone in 15 minutes. Spec §4.1 — covers OTP brute force / social engineering.",
    expression: {
      type: "and",
      clauses: [
        {
          field: "user.recentOtpRequests",
          operator: "gte",
          value: 5,
        },
      ],
      score_delta: 50,
    },
  },
  {
    name: "failed_login_burst_v1",
    description:
      "More than 10 failed logins from the same IP in 15 minutes. Spec §4.1 — credential stuffing / brute force.",
    expression: {
      type: "and",
      clauses: [
        {
          field: "user.recentFailedLogins",
          operator: "gte",
          value: 10,
        },
      ],
      score_delta: 40,
    },
  },
  {
    name: "impossible_travel_v1",
    description:
      "Login from a different country within 1 hour of last successful login from another country. Spec §4.1 — ATO via stolen credentials.",
    expression: {
      type: "and",
      clauses: [
        {
          field: "user.distinctCountriesLast30d",
          operator: "gte",
          value: 2,
        },
        {
          field: "event.country",
          operator: "ne",
          value: "__USER_LAST_COUNTRY__",
        },
      ],
      score_delta: 50,
    },
  },
  {
    name: "new_account_large_topup_v1",
    description:
      "First top-up exceeds 100 LYD within 24h of account creation. Spec §4.1 — money-mule / stolen-card pattern.",
    expression: {
      type: "and",
      clauses: [
        {
          field: "event.amount",
          operator: "gt",
          value: 100,
        },
        {
          field: "user.accountAgeDays",
          operator: "lt",
          value: 1,
        },
      ],
      score_delta: 60,
    },
  },
  {
    name: "card_fingerprint_shared_v1",
    description:
      "Same card fingerprint observed across more than 2 user accounts. Spec §4.1 — multi-account / mule ring.",
    expression: {
      type: "and",
      clauses: [
        {
          field: "user.sameCardAccountCountLast7d",
          operator: "gt",
          value: 2,
        },
      ],
      score_delta: 70,
    },
  },
  {
    name: "otp_burst_per_ip_v1",
    description:
      "More than 20 OTP requests from the same IP in 1 hour. Spec §4.1 — bot-pattern OTP harvesting.",
    expression: {
      type: "and",
      clauses: [
        {
          field: "user.recentOtpRequests",
          operator: "gte",
          value: 20,
        },
      ],
      score_delta: 30,
    },
  },
];

async function main() {
  let inserted = 0;
  let skipped = 0;
  for (const rule of PHASE1_RULES) {
    const existing = await db
      .select({ id: riskRulesTable.id })
      .from(riskRulesTable)
      .where(eq(riskRulesTable.name, rule.name))
      .limit(1);
    if (existing.length > 0) {
      skipped++;
      console.log(`  ↪︎ skip   ${rule.name} (already seeded)`);
      continue;
    }
    await db.insert(riskRulesTable).values({
      name: rule.name,
      description: rule.description,
      expression: rule.expression,
      enabled: true,
      version: 1,
    });
    inserted++;
    console.log(`  ✓ insert ${rule.name} (+${rule.expression.score_delta})`);
  }
  console.log(`\nDone. inserted=${inserted} skipped=${skipped}`);
}

void main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("seed failed:", err);
    process.exit(1);
  });
