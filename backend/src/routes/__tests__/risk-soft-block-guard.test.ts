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
import { riskEventsTable, riskConfigTable } from "@workspace/db";
import { invalidateRiskConfig } from "../../services/risk-config-cache.service";

/**
 * F1 (round-94 A4 → C5): the soft-block middleware was dead code — never
 * mounted on any route, so a risk engine `soft_block` decision was stored
 * and never enforced. The guard mode is now wired on the two user money
 * paths (POST /api/orders, POST /api/wallet/topups):
 *
 *   - tagged buyer → 423, no order/topup row written, sessions wiped,
 *     discharge sentinel recorded;
 *   - retry after re-auth (sentinel newer than the tag) → passes —
 *     soft_block is friction, not lockout (hard_block remains the
 *     refusal layer, off the money path per its own contract);
 *   - RISK_PIPELINE_ENABLED off → no-op (safe-by-default);
 *   - risk_config.autoBlockEnabled.softBlock=false → no-op.
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
`;

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

let phoneSeq = 94_300_000;
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
    .values({ name: "Guarded Product", price: "10.00" })
    .returning();
  await db.insert(inventoryTable).values({
    productId: p.id,
    accountEmail: "guard@test.local",
    accountPassword: "pw-guard",
  });
  return p.id;
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
  await db.execute(sql.raw("TRUNCATE risk_events, risk_config RESTART IDENTITY"));
  // getRiskConfig memoizes for 60s — reset so each scenario re-seeds.
  await invalidateRiskConfig();
});

describe("F1 — risk soft-block guard on POST /api/orders", () => {
  it("refuses a soft_block-tagged buyer with 423, writes no order, wipes sessions, records the discharge sentinel", async () => {
    const app = buildOrdersApp();
    const { url, close } = await listen(app);
    try {
      const { id: userId, token } = await seedUser();
      const productId = await seedProductWithStock();
      await tagSoftBlock(userId);
      await db.insert(sessionsTable).values({
        id: "sess-guard-1",
        userId,
        expiresAt: new Date(Date.now() + 3600_000),
      });

      const res = await post(url, "/api/orders", token, { product_id: productId });
      expect(res.status).toBe(423);
      expect(res.body).toMatchObject({ code: "FORBIDDEN" });

      // Nothing charged / created.
      expect(await countOrders(userId)).toBe(0);
      const [balanceRow] = await db
        .select({ b: usersTable.walletBalance })
        .from(usersTable)
        .where(eq(usersTable.id, userId));
      expect(String(balanceRow.b)).toBe("50.00");

      // Session wiped (the friction half of the guard).
      const liveSessions = await db
        .select({ id: sessionsTable.id })
        .from(sessionsTable)
        .where(eq(sessionsTable.userId, userId));
      expect(liveSessions).toHaveLength(0);

      // Discharge sentinel recorded.
      const sentinels = await db
        .select({ id: riskEventsTable.id, ruleFired: riskEventsTable.ruleFired })
        .from(riskEventsTable)
        .where(eq(riskEventsTable.userId, userId));
      expect(sentinels.some((s) => (s.ruleFired ?? []).includes("soft_block_discharged"))).toBe(
        true,
      );
    } finally {
      close();
    }
  });

  it("lets the retry through after the re-auth discharge (friction, not lockout)", async () => {
    const app = buildOrdersApp();
    const { url, close } = await listen(app);
    try {
      const { id: userId, token } = await seedUser();
      const productId = await seedProductWithStock();
      await tagSoftBlock(userId);

      const refused = await post(url, "/api/orders", token, { product_id: productId });
      expect(refused.status).toBe(423);

      // The user re-authenticated (new token/session) and retries.
      const retry = await post(url, "/api/orders", token, { product_id: productId });
      expect(retry.status).toBe(201);
      expect(await countOrders(userId)).toBe(1);
      const [balanceRow] = await db
        .select({ b: usersTable.walletBalance })
        .from(usersTable)
        .where(eq(usersTable.id, userId));
      expect(String(balanceRow.b)).toBe("40.00");
    } finally {
      close();
    }
  });

  it("is a no-op when RISK_PIPELINE_ENABLED is off (safe-by-default)", async () => {
    const app = buildOrdersApp();
    const { url, close } = await listen(app);
    try {
      delete process.env.RISK_PIPELINE_ENABLED;
      const { id: userId, token } = await seedUser();
      const productId = await seedProductWithStock();
      await tagSoftBlock(userId);

      const res = await post(url, "/api/orders", token, { product_id: productId });
      expect(res.status).toBe(201);
      expect(await countOrders(userId)).toBe(1);
    } finally {
      process.env.RISK_PIPELINE_ENABLED = "true";
      close();
    }
  });

  it("is a no-op when risk_config.autoBlockEnabled.softBlock is false", async () => {
    const app = buildOrdersApp();
    const { url, close } = await listen(app);
    try {
      await db.insert(riskConfigTable).values({
        id: 1,
        thresholds: { low: 0, medium: 30, high: 60, critical: 85 },
        allowlist: { ips: [], devices: [], phones: [] },
        autoBlockEnabled: { softBlock: false, hardBlock: false, alert: true },
        modelEnabled: false,
      });
      await invalidateRiskConfig();

      const { id: userId, token } = await seedUser();
      const productId = await seedProductWithStock();
      await tagSoftBlock(userId);

      const res = await post(url, "/api/orders", token, { product_id: productId });
      expect(res.status).toBe(201);
    } finally {
      close();
    }
  });

  it("does not consume the caller's Idempotency-Key when refusing (guard runs before idempotency)", async () => {
    const app = buildOrdersApp();
    const { url, close } = await listen(app);
    try {
      const { id: userId, token } = await seedUser();
      const productId = await seedProductWithStock();
      await tagSoftBlock(userId);
      const key = { "Idempotency-Key": "guard key 12345678" };

      const refused = await post(url, "/api/orders", token, { product_id: productId }, key);
      expect(refused.status).toBe(423);

      // Same key, retry after discharge — must be able to CLAIM the key
      // (i.e. the refusal did not register it anywhere).
      const retry = await post(url, "/api/orders", token, { product_id: productId }, key);
      expect(retry.status).toBe(201);
    } finally {
      close();
    }
  });
});

describe("F1 — risk soft-block guard on POST /api/wallet/topups", () => {
  it("refuses a tagged user's topup submission with 423 and writes no row", async () => {
    const app = buildWalletApp();
    const { url, close } = await listen(app);
    try {
      const { id: userId, token } = await seedUser();
      await tagSoftBlock(userId);

      const res = await post(url, "/api/wallet/topups", token, {
        amount: 20,
        payment_method: "mobile_transfer",
        payment_network: "madar",
        // B4-R1 (R111): reference required for mobile_transfer now.
        payment_reference: "TRX-RISK-SB",
      });
      expect(res.status).toBe(423);
      expect(res.body).toMatchObject({ code: "FORBIDDEN" });

      const topups = await db
        .select({ id: walletTopupsTable.id })
        .from(walletTopupsTable)
        .where(eq(walletTopupsTable.userId, userId));
      expect(topups).toHaveLength(0);
    } finally {
      close();
    }
  });

  it("passes an untagged user normally (regression: purchase/topup flow intact)", async () => {
    const app = buildWalletApp();
    const { url, close } = await listen(app);
    try {
      const { token } = await seedUser();
      const res = await post(url, "/api/wallet/topups", token, {
        amount: 20,
        payment_method: "mobile_transfer",
        payment_network: "madar",
        // B4-R1 (R111): reference required for mobile_transfer now.
        payment_reference: "TRX-RISK-SB",
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ amount: 20, status: "pending" });
    } finally {
      close();
    }
  });
});
