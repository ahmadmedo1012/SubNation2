import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  db,
  execTestSql,
  initTestDb,
  inventoryTable,
  ordersTable,
  productsTable,
  resetTestDb,
  sessionsTable,
  usersTable,
  walletTopupsTable,
} from "../../test/db";
import { signUserToken } from "../../lib/jwt";
import { ordersRouter } from "../orders";
import { walletRouter } from "../wallet";
import { auditLogsTable, riskEventsTable, riskConfigTable } from "@workspace/db";
import { invalidateRiskConfig } from "../../services/risk-config-cache.service";

/**
 * 98-B3 (round-98 wave B — R98 dead-code audit §1 [P2] "orphan file" +
 * backend-routes-api P3-3): the hard-block middleware was implemented
 * and spec-marked done but mounted NOWHERE — a `hard_block` risk event
 * was stored and never enforced. It is now wired on the two
 * user-initiated money-submission routes, immediately AFTER requireUser
 * and BEFORE the soft-block guard + the idempotency middleware:
 *
 *   - RISK_PIPELINE_ENABLED unset (current production) → no-op on both
 *     routes (the mount changes nothing until an operator opts in);
 *   - flag on + gates on (modelEnabled + autoBlockEnabled.hardBlock) +
 *     recent hard_block event → 423 with the hard refusal message, no
 *     order/topup row, no charge, audit `risk.hard_block_applied`;
 *   - flag on + no event / event for ANOTHER user / event older than
 *     the 1h window → passes;
 *   - config gates off (modelEnabled or hardBlock false) → no-op;
 *   - a refusal never consumes the caller's Idempotency-Key;
 *   - severity ordering: a buyer tagged BOTH soft_block and hard_block
 *     gets the hard 423 — sessions intact, no discharge sentinel, the
 *     honest "contact support" message (the soft guard's friction never
 *     runs for a hard-refused buyer).
 *
 * Conventions mirror risk-soft-block-guard.test.ts (pglite harness,
 * RISK_DDL for the risk tables, signUserToken cookies, per-scenario
 * risk_config seeding + cache invalidation). audit_logs is created here
 * too so the middleware's audit write is assertable (the soft suite
 * runs without it — writeAuditLog self-catches there).
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
CREATE TYPE audit_actor_type AS ENUM ('user','admin','system');
CREATE TABLE audit_logs (
  id serial PRIMARY KEY,
  actor_id integer,
  actor_type audit_actor_type NOT NULL DEFAULT 'system',
  action varchar(100) NOT NULL,
  target_type varchar(50),
  target_id integer,
  metadata text,
  ip varchar(45),
  user_agent varchar(500),
  created_at timestamptz NOT NULL DEFAULT now()
);
`;

/** The hard refusal message risk-hard-block.ts defines (distinct from the
 * soft guard's "re-login and retry" message — the ordering test relies
 * on the difference). */
const HARD_REFUSAL_MESSAGE = "تم تعليق هذا الإجراء مؤقتًا — يرجى التواصل مع الدعم";

function buildOrdersApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/orders", ordersRouter);
  return app;
}

function buildWalletApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/wallet", walletRouter);
  return app;
}

async function listen(app: Express): Promise<{ url: string; close: () => void }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("no address"));
        return;
      }
      resolve({ url: `http://127.0.0.1:${addr.port}`, close: () => server.close() });
    });
  });
}

let phoneSeq = 98_310_000;
async function seedUser(balance = "50.00"): Promise<{ id: number; token: string }> {
  phoneSeq += 1;
  const [u] = await db
    .insert(usersTable)
    .values({ phone: String(phoneSeq), walletBalance: balance })
    .returning();
  return { id: u.id, token: signUserToken({ userId: u.id }) };
}

async function seedProductWithStock(): Promise<number> {
  const [p] = await db
    .insert(productsTable)
    .values({ name: "Hard-Blocked Product", price: "10.00" })
    .returning();
  await db.insert(inventoryTable).values({
    productId: p.id,
    accountEmail: "hardblock@test.local",
    accountPassword: "pw-hard",
  });
  return p.id;
}

/**
 * Insert a hard_block tag for the user. Mirrors the shape the scoring
 * side writes (decideAction: level=critical + both config gates on) —
 * the window check only counts rows younger than 1h, hence ageMs.
 */
async function tagHardBlock(userId: number, ageMs = 0): Promise<void> {
  await db.insert(riskEventsTable).values({
    userId,
    eventType: "order_create",
    score: 95,
    level: "critical",
    confidence: "0.970",
    ruleFired: ["card_fingerprint_shared_v1"],
    actionTaken: "hard_block",
    createdAt: ageMs > 0 ? new Date(Date.now() - ageMs) : new Date(),
  });
}

async function tagSoftBlock(userId: number): Promise<void> {
  await db.insert(riskEventsTable).values({
    userId,
    eventType: "order_create",
    score: 90,
    level: "high",
    confidence: "0.950",
    ruleFired: ["velocity_rule"],
    actionTaken: "soft_block",
  });
}

/** Turn BOTH hard gates on (the production-default OFF shape is covered
 * by the no-config and gate-off tests below). */
async function enableHardBlockConfig(): Promise<void> {
  await db.insert(riskConfigTable).values({
    id: 1,
    thresholds: { low: 0, medium: 30, high: 60, critical: 85 },
    allowlist: { ips: [], devices: [], phones: [] },
    autoBlockEnabled: { softBlock: true, hardBlock: true, alert: true },
    modelEnabled: true,
  });
  await invalidateRiskConfig();
}

async function post(
  url: string,
  path: string,
  token: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  const res = await fetch(`${url}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: `auth_token=${token}`, ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function countOrders(userId: number): Promise<number> {
  const rows = await db
    .select({ id: ordersTable.id })
    .from(ordersTable)
    .where(eq(ordersTable.userId, userId));
  return rows.length;
}

beforeAll(async () => {
  await initTestDb();
  await execTestSql(RISK_DDL);
  process.env.RISK_PIPELINE_ENABLED = "true";
});

afterAll(() => {
  delete process.env.RISK_PIPELINE_ENABLED;
});

beforeEach(async () => {
  await resetTestDb();
  await db.execute(sql.raw("TRUNCATE risk_events, risk_config, audit_logs RESTART IDENTITY"));
  // getRiskConfig memoizes for 60s — reset so each scenario re-seeds.
  await invalidateRiskConfig();
});

describe("98-B3 — risk hard-block on POST /api/orders", () => {
  it("is a no-op when RISK_PIPELINE_ENABLED is unset — request passes untouched (default production shape)", async () => {
    const app = buildOrdersApp();
    const { url, close } = await listen(app);
    try {
      delete process.env.RISK_PIPELINE_ENABLED;
      const { id: userId, token } = await seedUser();
      const productId = await seedProductWithStock();
      await tagHardBlock(userId);
      // No risk_config row either — the fully-default environment.

      const res = await post(url, "/api/orders", token, { product_id: productId });
      expect(res.status).toBe(201);
      expect(await countOrders(userId)).toBe(1);

      const [balanceRow] = await db
        .select({ b: usersTable.walletBalance })
        .from(usersTable)
        .where(eq(usersTable.id, userId));
      expect(String(balanceRow.b)).toBe("40.00");

      // No refusal artifacts: no audit row, no session wipe.
      const audits = await db
        .select({ id: auditLogsTable.id })
        .from(auditLogsTable)
        .where(eq(auditLogsTable.action, "risk.hard_block_applied"));
      expect(audits).toHaveLength(0);
    } finally {
      process.env.RISK_PIPELINE_ENABLED = "true";
      close();
    }
  });

  it("refuses a hard_block-tagged buyer with 423 + the hard refusal message; no order, no charge, no session wipe; audit risk.hard_block_applied", async () => {
    const app = buildOrdersApp();
    const { url, close } = await listen(app);
    try {
      await enableHardBlockConfig();
      const { id: userId, token } = await seedUser();
      const productId = await seedProductWithStock();
      await tagHardBlock(userId);
      await db.insert(sessionsTable).values({
        id: "sess-hard-1",
        userId,
        expiresAt: new Date(Date.now() + 3600_000),
      });

      const res = await post(url, "/api/orders", token, { product_id: productId });
      expect(res.status).toBe(423);
      expect(res.body).toMatchObject({ code: "FORBIDDEN", error: HARD_REFUSAL_MESSAGE });

      // Nothing charged / created.
      expect(await countOrders(userId)).toBe(0);
      const [balanceRow] = await db
        .select({ b: usersTable.walletBalance })
        .from(usersTable)
        .where(eq(usersTable.id, userId));
      expect(String(balanceRow.b)).toBe("50.00");

      // Hard refusal ≠ friction: sessions are NOT wiped (re-auth is the
      // soft guard's remedy; here the remedy is contacting support).
      const liveSessions = await db
        .select({ id: sessionsTable.id })
        .from(sessionsTable)
        .where(eq(sessionsTable.userId, userId));
      expect(liveSessions).toHaveLength(1);

      // Audit trail (T011a contract: action='risk.hard_block_applied').
      const audits = await db
        .select({
          action: auditLogsTable.action,
          targetType: auditLogsTable.targetType,
          targetId: auditLogsTable.targetId,
        })
        .from(auditLogsTable)
        .where(eq(auditLogsTable.action, "risk.hard_block_applied"));
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({ targetType: "user", targetId: userId });
    } finally {
      close();
    }
  });

  it("passes when the user has no risk events (flag on, gates on)", async () => {
    const app = buildOrdersApp();
    const { url, close } = await listen(app);
    try {
      await enableHardBlockConfig();
      const { id: userId, token } = await seedUser();
      const productId = await seedProductWithStock();

      const res = await post(url, "/api/orders", token, { product_id: productId });
      expect(res.status).toBe(201);
      expect(await countOrders(userId)).toBe(1);
    } finally {
      close();
    }
  });

  it("passes when the hard_block event belongs to ANOTHER user", async () => {
    const app = buildOrdersApp();
    const { url, close } = await listen(app);
    try {
      await enableHardBlockConfig();
      const other = await seedUser();
      await tagHardBlock(other.id);

      const { id: userId, token } = await seedUser();
      const productId = await seedProductWithStock();

      const res = await post(url, "/api/orders", token, { product_id: productId });
      expect(res.status).toBe(201);
      expect(await countOrders(userId)).toBe(1);
    } finally {
      close();
    }
  });

  it("passes when the hard_block event is older than the 1h window", async () => {
    const app = buildOrdersApp();
    const { url, close } = await listen(app);
    try {
      await enableHardBlockConfig();
      const { id: userId, token } = await seedUser();
      const productId = await seedProductWithStock();
      await tagHardBlock(userId, 2 * 60 * 60 * 1000); // 2h — outside the window

      const res = await post(url, "/api/orders", token, { product_id: productId });
      expect(res.status).toBe(201);
      expect(await countOrders(userId)).toBe(1);
    } finally {
      close();
    }
  });

  it("is a no-op when risk_config.modelEnabled=false even with hardBlock=true (config gate)", async () => {
    const app = buildOrdersApp();
    const { url, close } = await listen(app);
    try {
      await db.insert(riskConfigTable).values({
        id: 1,
        thresholds: { low: 0, medium: 30, high: 60, critical: 85 },
        allowlist: { ips: [], devices: [], phones: [] },
        autoBlockEnabled: { softBlock: true, hardBlock: true, alert: true },
        modelEnabled: false,
      });
      await invalidateRiskConfig();

      const { id: userId, token } = await seedUser();
      const productId = await seedProductWithStock();
      await tagHardBlock(userId);

      const res = await post(url, "/api/orders", token, { product_id: productId });
      expect(res.status).toBe(201);
    } finally {
      close();
    }
  });

  it("is a no-op when risk_config.autoBlockEnabled.hardBlock=false even with modelEnabled=true (config gate)", async () => {
    const app = buildOrdersApp();
    const { url, close } = await listen(app);
    try {
      await db.insert(riskConfigTable).values({
        id: 1,
        thresholds: { low: 0, medium: 30, high: 60, critical: 85 },
        allowlist: { ips: [], devices: [], phones: [] },
        autoBlockEnabled: { softBlock: true, hardBlock: false, alert: true },
        modelEnabled: true,
      });
      await invalidateRiskConfig();

      const { id: userId, token } = await seedUser();
      const productId = await seedProductWithStock();
      await tagHardBlock(userId);

      const res = await post(url, "/api/orders", token, { product_id: productId });
      expect(res.status).toBe(201);
    } finally {
      close();
    }
  });

  it("does not consume the caller's Idempotency-Key when refusing (runs before idempotency)", async () => {
    const app = buildOrdersApp();
    const { url, close } = await listen(app);
    try {
      await enableHardBlockConfig();
      const { id: userId, token } = await seedUser();
      const productId = await seedProductWithStock();
      await tagHardBlock(userId);
      const key = { "Idempotency-Key": "hard guard key 12345678" };

      const refused = await post(url, "/api/orders", token, { product_id: productId }, key);
      expect(refused.status).toBe(423);

      // The block expires (1h window — simulated by removing the tag);
      // the SAME key must still be claimable by the retry, proving the
      // refusal did not register it anywhere.
      await db.delete(riskEventsTable).where(eq(riskEventsTable.userId, userId));
      const retry = await post(url, "/api/orders", token, { product_id: productId }, key);
      expect(retry.status).toBe(201);
    } finally {
      close();
    }
  });

  it("answers BEFORE the soft guard: a both-tagged buyer gets the hard 423 — sessions intact, no discharge sentinel, audit hard_block_applied", async () => {
    const app = buildOrdersApp();
    const { url, close } = await listen(app);
    try {
      await enableHardBlockConfig();
      const { id: userId, token } = await seedUser();
      const productId = await seedProductWithStock();
      await tagSoftBlock(userId);
      await tagHardBlock(userId);
      await db.insert(sessionsTable).values({
        id: "sess-ordering-1",
        userId,
        expiresAt: new Date(Date.now() + 3600_000),
      });

      const res = await post(url, "/api/orders", token, { product_id: productId });
      expect(res.status).toBe(423);
      // The HARD message (not the soft guard's "re-login and retry").
      expect(res.body).toMatchObject({ code: "FORBIDDEN", error: HARD_REFUSAL_MESSAGE });

      // The soft guard never ran: no friction side effects for a
      // hard-refused buyer — sessions stay, no discharge sentinel.
      const liveSessions = await db
        .select({ id: sessionsTable.id })
        .from(sessionsTable)
        .where(eq(sessionsTable.userId, userId));
      expect(liveSessions).toHaveLength(1);
      const sentinels = await db
        .select({ id: riskEventsTable.id, ruleFired: riskEventsTable.ruleFired })
        .from(riskEventsTable)
        .where(eq(riskEventsTable.userId, userId));
      expect(sentinels.some((s) => (s.ruleFired ?? []).includes("soft_block_discharged"))).toBe(
        false,
      );

      // The audit records the hard refusal, not the soft one.
      const audits = await db
        .select({ action: auditLogsTable.action })
        .from(auditLogsTable)
        .where(eq(auditLogsTable.action, "risk.hard_block_applied"));
      expect(audits).toHaveLength(1);
    } finally {
      close();
    }
  });
});

describe("98-B3 — risk hard-block on POST /api/wallet/topups", () => {
  it("is a no-op when RISK_PIPELINE_ENABLED is unset — topup passes untouched (default production shape)", async () => {
    const app = buildWalletApp();
    const { url, close } = await listen(app);
    try {
      delete process.env.RISK_PIPELINE_ENABLED;
      const { id: userId, token } = await seedUser();
      await tagHardBlock(userId);

      const res = await post(url, "/api/wallet/topups", token, {
        amount: 20,
        payment_method: "mobile_transfer",
        payment_network: "madar",
        // B4-R1 (R111): reference required for mobile_transfer now.
        payment_reference: "TRX-RISK-HB",
      });
      expect(res.status).toBe(201);

      const topups = await db
        .select({ id: walletTopupsTable.id })
        .from(walletTopupsTable)
        .where(eq(walletTopupsTable.userId, userId));
      expect(topups).toHaveLength(1);
    } finally {
      process.env.RISK_PIPELINE_ENABLED = "true";
      close();
    }
  });

  it("refuses a hard_block-tagged user's topup submission with 423 and writes no row", async () => {
    const app = buildWalletApp();
    const { url, close } = await listen(app);
    try {
      await enableHardBlockConfig();
      const { id: userId, token } = await seedUser();
      await tagHardBlock(userId);

      const res = await post(url, "/api/wallet/topups", token, {
        amount: 20,
        payment_method: "mobile_transfer",
        payment_network: "madar",
        // B4-R1 (R111): reference required for mobile_transfer now.
        payment_reference: "TRX-RISK-HB",
      });
      expect(res.status).toBe(423);
      expect(res.body).toMatchObject({ code: "FORBIDDEN", error: HARD_REFUSAL_MESSAGE });

      const topups = await db
        .select({ id: walletTopupsTable.id })
        .from(walletTopupsTable)
        .where(eq(walletTopupsTable.userId, userId));
      expect(topups).toHaveLength(0);
    } finally {
      close();
    }
  });

  it("passes an untagged user normally (regression: topup flow intact)", async () => {
    const app = buildWalletApp();
    const { url, close } = await listen(app);
    try {
      await enableHardBlockConfig();
      const { token } = await seedUser();
      const res = await post(url, "/api/wallet/topups", token, {
        amount: 20,
        payment_method: "mobile_transfer",
        payment_network: "madar",
        // B4-R1 (R111): reference required for mobile_transfer now.
        payment_reference: "TRX-RISK-HB",
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ amount: 20, status: "pending" });
    } finally {
      close();
    }
  });

  it("passes when the hard_block event belongs to another user", async () => {
    const app = buildWalletApp();
    const { url, close } = await listen(app);
    try {
      await enableHardBlockConfig();
      const other = await seedUser();
      await tagHardBlock(other.id);

      const { id: userId, token } = await seedUser();
      const res = await post(url, "/api/wallet/topups", token, {
        amount: 20,
        payment_method: "mobile_transfer",
        payment_network: "madar",
        // B4-R1 (R111): reference required for mobile_transfer now.
        payment_reference: "TRX-RISK-HB",
      });
      expect(res.status).toBe(201);

      const topups = await db
        .select({ id: walletTopupsTable.id })
        .from(walletTopupsTable)
        .where(eq(walletTopupsTable.userId, userId));
      expect(topups).toHaveLength(1);
    } finally {
      close();
    }
  });
});
