import type { Express } from "express";
import { sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  HealthCheckResponse,
  ListProductsResponse,
  GetProductResponse,
  GetProductBySlugResponse,
  GetCatalogStatsResponse,
  GetFlashSaleResponse,
  ListPublicAuthProvidersResponse,
  GetWalletResponse,
  ListTopupsResponse,
  GetWalletLedgerResponse,
  ListOrdersResponse,
  GetLoyaltyResponse,
  GetLoyaltyLedgerResponse,
  ListNotificationsResponse,
  GetCartResponse,
  AddCartItemResponse,
  CreateTopupResponse,
  ValidateCouponResponse,
  AdminLoginResponse,
  ListAdminOrdersResponse,
  ListAdminTopupsResponse,
  // R126-L8b (A4 §D batch-1) — the 17 newly-exposed admin endpoints.
  ListAdminAlertsResponse,
  GetAdminAlertsUnreadCountResponse,
  MarkAdminAlertReadResponse,
  MarkAllAdminAlertsReadResponse,
  DeleteAdminAlertResponse,
  DeleteReadAdminAlertsResponse,
  DeleteAllAdminAlertsResponse,
  ListAdminTicketsResponse,
  GetAdminTicketResponse,
  ReplyAdminTicketResponse,
  UpdateAdminTicketStatusResponse,
  GetAdminSettingsResponse,
  GetAdminAuthSettingsResponse,
  GetAdminChartDataResponse,
  GetAdminAuthStatsSummaryResponse,
  ListAdminAuthActivityResponse,
  ListAdminReferralsResponse,
  // R127-L1 (B1 §4 batch-2) — the 10 newly-exposed observability /
  // diagnostics / alerts / risk / forecast endpoints.
  GetAdminObservabilityMetricsResponse,
  GetAdminObservabilitySummaryResponse,
  GetAdminObservabilitySchedulerResponse,
  GetAdminObservabilityAlertsRecentResponse,
  GetAdminDiagnosticsResponse,
  ListAdminNewAlertsResponse,
  GetAdminRiskDashboardResponse,
  ListAdminRiskEventsResponse,
  ListAdminForecastAtRiskResponse,
  GetAdminForecastProductResponse,
  // R127-L5 (B15-1) — the audit-trail reader.
  ListAdminAuditLogsResponse,
} from "@workspace/api-zod";
import {
  db,
  initTestDb,
  resetTestDb,
  usersTable,
  productsTable,
  couponsTable,
  adminUsersTable,
  // R126-L8b: batch-1 seed tables.
  adminAlertsTable,
  supportTicketsTable,
  ticketRepliesTable,
  referralEventsTable,
  authActivityTable,
  // R127-L5 (B15-1): audit_logs is already part of the shared harness
  // DDL + resetTestDb's TRUNCATE list (R116) — the reader row seeds it
  // directly.
  auditLogsTable,
} from "../test/db";
import { signUserToken, signAdminToken } from "../lib/jwt";
import { hashPassword } from "../lib/crypto";
// R127-L1 (batch-2): the risk + forecast seed tables (re-exported by the
// pglite harness from @workspace/db/schema).
import {
  riskEventsTable,
  riskLabelsTable,
  inventoryForecastRunsTable,
  inventoryForecastsTable,
} from "../test/db";

/**
 * R123-E2 — the OpenAPI response-contract suite (R122's deferred item).
 *
 * WHAT THIS CATCHES: response-shape drift between the openapi.yaml spec
 * (which feeds the orval-generated zod schemas used by the FRONTEND via
 * @workspace/api-client-react) and what the backend handlers actually
 * emit. Before this file, a handler field rename broke production at
 * runtime and nothing in CI noticed (path parity ≠ shape parity).
 *
 * HOW: the REAL app object is imported (the full middleware stack —
 * auth, CSRF gate, rate limiters, error envelope, cache headers —
 * exactly what production runs), exercised via real fetch on an
 * ephemeral port, and every 2xx body is validated with the
 * orval-generated zod Response schema via safeParse. Any field the
 * spec doesn't know about, or any type change, fails here.
 *
 * DB: the pglite harness carries the real constraints — no test can
 * reach production. Env bootstrap comes from src/test/env.ts
 * (vitest setupFiles).
 *
 * CONVENTION: one `it` per endpoint. Keep this file append-only as
 * endpoints gain documented schemas — the CI value compounds.
 */

type AppModule = typeof import("../app");
let realApp: Express;

beforeAll(async () => {
  const appModule: AppModule = await import("../app");
  realApp = appModule.default;
  await initTestDb();
  // R126-L8b: auth_activity is not part of the shared harness DDL (the
  // admin-security-summary convention) — provision it per-file so the
  // REAL app's /admin/auth-activity + /admin/auth-stats/summary can be
  // contract-pinned here too. resetTestDb's TRUNCATE list doesn't know
  // it, so the beforeEach below clears it manually.
  await db.execute(
    sql`CREATE TABLE IF NOT EXISTS auth_activity (
      id serial PRIMARY KEY,
      user_id integer,
      identifier varchar(255) NOT NULL,
      action varchar(50) NOT NULL,
      provider varchar(50),
      success boolean NOT NULL,
      ip_address varchar(45),
      user_agent text,
      failure_reason varchar(255),
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
  );
  // R127-L1 (batch-2): the risk + forecast families are not part of the
  // shared harness DDL either (same convention as auth_activity) — the
  // risk-soft-block-guard / forecast route suites each provision their
  // own; the contract rows need risk_events + risk_labels (the review
  // queue + the unresolved aggregate) and inventory_forecast_runs +
  // inventory_forecasts (the at-risk panel + the per-product drawer).
  // Types wrapped in DO-blocks so a same-process re-run cannot fail on
  // duplicate_object.
  await db.execute(sql`DO $$ BEGIN
    CREATE TYPE risk_event_type AS ENUM (
      'login_attempt','login_success','login_failure','otp_request','otp_verify',
      'topup_attempt','topup_success','order_create','order_deliver','coupon_apply',
      'referral_event','admin_force_reauth');
    CREATE TYPE risk_level AS ENUM ('low','medium','high','critical');
    CREATE TYPE risk_action_taken AS ENUM ('none','log','soft_block','hard_block','alert');
    CREATE TYPE risk_label_kind AS ENUM ('confirmed_fraud','false_positive','escalated');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
  await db.execute(sql`CREATE TABLE IF NOT EXISTS risk_events (
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
  )`);
  await db.execute(sql`CREATE TABLE IF NOT EXISTS risk_labels (
    id serial PRIMARY KEY,
    risk_event_id integer REFERENCES risk_events(id) ON DELETE SET NULL,
    label risk_label_kind NOT NULL,
    labeled_by integer REFERENCES admin_users(id) ON DELETE SET NULL,
    labeled_at timestamptz NOT NULL DEFAULT now(),
    notes text
  )`);
  await db.execute(sql`CREATE TABLE IF NOT EXISTS inventory_forecast_runs (
    id serial PRIMARY KEY,
    started_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    outcome varchar(20) NOT NULL DEFAULT 'in_flight',
    products_predicted integer NOT NULL DEFAULT 0,
    products_skipped jsonb NOT NULL DEFAULT '{}',
    alerts_emitted integer NOT NULL DEFAULT 0,
    alerts_capped boolean NOT NULL DEFAULT false,
    capture_rate_14d numeric(4,3),
    worker_tier varchar(50),
    failure_reason text
  )`);
  await db.execute(sql`CREATE TABLE IF NOT EXISTS inventory_forecasts (
    id serial PRIMARY KEY,
    run_id integer NOT NULL REFERENCES inventory_forecast_runs(id) ON DELETE CASCADE,
    product_id integer NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    forecast_date date NOT NULL,
    current_stock_on_hand integer NOT NULL,
    avg_daily_sales numeric(8,4),
    dow_blend_7d numeric(8,4),
    predicted_demand_7d integer,
    predicted_demand_30d integer,
    predicted_runout_at date,
    recommended_reorder_qty integer,
    confidence varchar(20) NOT NULL,
    at_risk boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
  )`);
}, 120_000);

beforeEach(async () => {
  await resetTestDb();
  await db.execute(sql`DELETE FROM auth_activity`);
  // R127-L1 (batch-2): the pglite harness's TRUNCATE list does not know
  // these four tables (same reason as auth_activity) — clear them in FK
  // order so each row starts from the seed below (pglite takes ONE
  // command per prepared statement — hence the four executes).
  await db.execute(sql`DELETE FROM risk_labels`);
  await db.execute(sql`DELETE FROM risk_events`);
  await db.execute(sql`DELETE FROM inventory_forecasts`);
  await db.execute(sql`DELETE FROM inventory_forecast_runs`);
});

// ── helpers ─────────────────────────────────────────────────────────────────

interface ApiOk {
  status: number;
  body: unknown;
}

function call(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  opts: { userToken?: string; adminToken?: string; body?: unknown } = {},
): Promise<ApiOk> {
  return new Promise((resolve, reject) => {
    const server = realApp.listen(0, async () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("listener address is not AddressInfo"));
        return;
      }
      try {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (opts.userToken) headers.Cookie = `auth_token=${opts.userToken}`;
        if (opts.adminToken) headers.Authorization = `Bearer ${opts.adminToken}`;
        // The REAL app runs the CSRF origin gate (mounted-router suites
        // bypass it): state-changing methods need an Origin on the
        // allow-list. The dev fallback list (app.ts) includes
        // http://127.0.0.1:3000 — the header is compared against the
        // allow-list, not against the actual listen port.
        if (method !== "GET") headers.Origin = "http://127.0.0.1:3000";
        const res = await fetch(`http://127.0.0.1:${addr.port}${path}`, {
          method,
          headers,
          body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        });
        const text = await res.text();
        const body = text ? (JSON.parse(text) as unknown) : null;
        resolve({ status: res.status, body });
      } catch (err) {
        reject(err);
      } finally {
        server.close();
      }
    });
  });
}

/** safeParse + issue dump — the one assertion shape this suite exists for. */
function expectContract(
  schema: { safeParse: (v: unknown) => { success: boolean; error?: { issues: unknown[] } } },
  body: unknown,
) {
  const parsed = schema.safeParse(body);
  expect(
    parsed.success,
    parsed.success
      ? "contract ok"
      : `CONTRACT DRIFT — issues: ${JSON.stringify((parsed as { error?: { issues: unknown[] } }).error?.issues, null, 2).slice(0, 2000)}`,
  ).toBe(true);
}

let phoneSeq = 92_100_000;
async function seedUser(overrides: Partial<{ balance: string; points: number }> = {}) {
  phoneSeq += 1;
  const [u] = await db
    .insert(usersTable)
    .values({
      phone: String(phoneSeq),
      walletBalance: overrides.balance ?? "25.00",
      loyaltyPoints: overrides.points ?? 120,
    })
    .returning();
  return u;
}

async function seedProduct() {
  const [p] = await db
    .insert(productsTable)
    .values({
      name: "Contract Test Product",
      slug: "contract-test-product",
      price: "50.00",
      isActive: true,
      category: "streaming",
    })
    .returning();
  return p;
}

async function seedAdmin() {
  const passwordHash = await hashPassword("contract-pass-1");
  const [a] = await db
    .insert(adminUsersTable)
    .values({ username: "contract-admin", passwordHash, isActive: true, permissions: ["all"] })
    .returning();
  return a;
}

// ── public surface ──────────────────────────────────────────────────────────

describe("response contracts — public", () => {
  it("GET /api/healthz → HealthCheckResponse", async () => {
    const res = await call("GET", "/api/healthz");
    expect(res.status).toBe(200);
    expectContract(HealthCheckResponse, res.body);
  });

  it("GET /api/products → ListProductsResponse", async () => {
    await seedProduct();
    const res = await call("GET", "/api/products");
    expect(res.status).toBe(200);
    expectContract(ListProductsResponse, res.body);
  });

  it("GET /api/products/{id} → GetProductResponse", async () => {
    const p = await seedProduct();
    const res = await call("GET", `/api/products/${p.id}`);
    expect(res.status).toBe(200);
    expectContract(GetProductResponse, res.body);
  });

  it("GET /api/products/by-slug/{slug} → GetProductBySlugResponse", async () => {
    await seedProduct();
    const res = await call("GET", "/api/products/by-slug/contract-test-product");
    expect(res.status).toBe(200);
    expectContract(GetProductBySlugResponse, res.body);
  });

  it("GET /api/catalog/stats → GetCatalogStatsResponse", async () => {
    const res = await call("GET", "/api/catalog/stats");
    expect(res.status).toBe(200);
    expectContract(GetCatalogStatsResponse, res.body);
  });

  it("GET /api/flash-sale → GetFlashSaleResponse (nullable without an active sale)", async () => {
    const res = await call("GET", "/api/flash-sale");
    expect(res.status).toBe(200);
    expectContract(GetFlashSaleResponse, res.body);
  });

  it("GET /api/auth/providers → ListPublicAuthProvidersResponse", async () => {
    const res = await call("GET", "/api/auth/providers");
    expect(res.status).toBe(200);
    expectContract(ListPublicAuthProvidersResponse, res.body);
  });
});

// ── authenticated user surface (cookie) ─────────────────────────────────────

describe("response contracts — user", () => {
  it("GET /api/wallet → GetWalletResponse", async () => {
    const u = await seedUser();
    const res = await call("GET", "/api/wallet", { userToken: signUserToken({ userId: u.id }) });
    expect(res.status).toBe(200);
    expectContract(GetWalletResponse, res.body);
  });

  it("GET /api/wallet/topups → ListTopupsResponse", async () => {
    const u = await seedUser();
    const res = await call("GET", "/api/wallet/topups", {
      userToken: signUserToken({ userId: u.id }),
    });
    expect(res.status).toBe(200);
    expectContract(ListTopupsResponse, res.body);
  });

  it("GET /api/wallet/ledger → GetWalletLedgerResponse", async () => {
    const u = await seedUser();
    const res = await call("GET", "/api/wallet/ledger", {
      userToken: signUserToken({ userId: u.id }),
    });
    expect(res.status).toBe(200);
    expectContract(GetWalletLedgerResponse, res.body);
  });

  it("GET /api/orders → ListOrdersResponse (empty array is a valid contract)", async () => {
    const u = await seedUser();
    const res = await call("GET", "/api/orders", { userToken: signUserToken({ userId: u.id }) });
    expect(res.status).toBe(200);
    expectContract(ListOrdersResponse, res.body);
  });

  it("GET /api/loyalty → GetLoyaltyResponse", async () => {
    const u = await seedUser({ points: 120 });
    const res = await call("GET", "/api/loyalty", { userToken: signUserToken({ userId: u.id }) });
    expect(res.status).toBe(200);
    expectContract(GetLoyaltyResponse, res.body);
  });

  it("GET /api/loyalty/ledger → GetLoyaltyLedgerResponse", async () => {
    const u = await seedUser();
    const res = await call("GET", "/api/loyalty/ledger", {
      userToken: signUserToken({ userId: u.id }),
    });
    expect(res.status).toBe(200);
    expectContract(GetLoyaltyLedgerResponse, res.body);
  });

  it("GET /api/notifications → ListNotificationsResponse", async () => {
    const u = await seedUser();
    const res = await call("GET", "/api/notifications", {
      userToken: signUserToken({ userId: u.id }),
    });
    expect(res.status).toBe(200);
    expectContract(ListNotificationsResponse, res.body);
  });

  it("GET /api/cart → GetCartResponse (empty cart)", async () => {
    const u = await seedUser();
    const res = await call("GET", "/api/cart", { userToken: signUserToken({ userId: u.id }) });
    expect(res.status).toBe(200);
    expectContract(GetCartResponse, res.body);
  });
});

// ── mutations (happy paths only — error matrices live in the route suites) ──

describe("response contracts — mutations", () => {
  it("POST /api/cart/items → 201 AddCartItemResponse", async () => {
    const u = await seedUser();
    const p = await seedProduct();
    const res = await call("POST", "/api/cart/items", {
      userToken: signUserToken({ userId: u.id }),
      body: { product_id: p.id, quantity: 1 },
    });
    expect(res.status).toBe(201);
    expectContract(AddCartItemResponse, res.body);
  });

  it("POST /api/wallet/topups → 201 CreateTopupResponse", async () => {
    const u = await seedUser();
    const res = await call("POST", "/api/wallet/topups", {
      userToken: signUserToken({ userId: u.id }),
      body: {
        amount: 20,
        payment_method: "mobile_transfer",
        payment_network: "madar",
        sender_phone: "0912345678",
        payment_reference: "CONTRACT-TRX-1",
      },
    });
    expect(res.status).toBe(201);
    expectContract(CreateTopupResponse, res.body);
  });

  it("POST /api/coupons/validate → ValidateCouponResponse", async () => {
    const u = await seedUser();
    await db.insert(couponsTable).values({
      code: "CONTRACT10",
      type: "percentage",
      value: "10.00",
      isActive: true,
    });
    const res = await call("POST", "/api/coupons/validate", {
      userToken: signUserToken({ userId: u.id }),
      body: { code: "contract10", order_amount: 50 },
    });
    expect(res.status).toBe(200);
    expectContract(ValidateCouponResponse, res.body);
  });
});

// ── admin surface (Bearer) ──────────────────────────────────────────────────

describe("response contracts — admin", () => {
  it("POST /api/admin/login → AdminLoginResponse", async () => {
    await seedAdmin();
    const res = await call("POST", "/api/admin/login", {
      body: { username: "contract-admin", password: "contract-pass-1" },
    });
    expect(res.status).toBe(200);
    expectContract(AdminLoginResponse, res.body);
  });

  it("GET /api/admin/orders → ListAdminOrdersResponse", async () => {
    const a = await seedAdmin();
    const res = await call("GET", "/api/admin/orders", {
      adminToken: signAdminToken({ adminId: a.id, role: "admin" }),
    });
    expect(res.status).toBe(200);
    expectContract(ListAdminOrdersResponse, res.body);
  });

  it("GET /api/admin/topups → ListAdminTopupsResponse", async () => {
    const a = await seedAdmin();
    const res = await call("GET", "/api/admin/topups", {
      adminToken: signAdminToken({ adminId: a.id, role: "admin" }),
    });
    expect(res.status).toBe(200);
    expectContract(ListAdminTopupsResponse, res.body);
  });
});

// ── admin batch-1 (R126-L8b, A4 §D) — 17 newly-exposed endpoints ───────────
//
// The batch-1 OpenAPI exposure (alerts ×7, tickets ×4, settings GET,
// settings/auth GET, chart-data, auth-stats/summary, auth-activity,
// referrals list). Every response schema was written field-by-field from
// the real handlers; these rows pin that honesty against the real app —
// a field the spec forgot or mistypes fails here, not in production.

let alertSeq = 0;
async function seedAlert(
  over: Partial<{
    type: string;
    message: string | null;
    isRead: boolean;
    dedupeKey: string | null;
  }> = {},
) {
  alertSeq += 1;
  const [row] = await db
    .insert(adminAlertsTable)
    .values({
      type: over.type ?? "system",
      title: `تنبيه اختبار العقد ${alertSeq}`,
      message: over.message === undefined ? "تفاصيل التنبيه" : over.message,
      isRead: over.isRead ?? false,
      dedupeKey: over.dedupeKey ?? null,
    })
    .returning();
  return row;
}

async function seedTicketWithReply() {
  const u = await seedUser();
  const [ticket] = await db
    .insert(supportTicketsTable)
    .values({ userId: u.id, title: "تذكرة عقد الاستجابة", category: "technical", status: "open" })
    .returning();
  await db
    .insert(ticketRepliesTable)
    .values({ ticketId: ticket.id, authorType: "user", message: "رسالة المستخدم الأولى" });
  return ticket;
}

async function seedReferralEvent(status: "pending" | "credited" = "pending") {
  const referrer = await seedUser();
  const referee = await seedUser();
  const [event] = await db
    .insert(referralEventsTable)
    .values({ referrerId: referrer.id, refereeId: referee.id, status })
    .returning();
  return event;
}

describe("response contracts — admin batch-1 (R126-L8b)", () => {
  it("GET /api/admin/alerts → ListAdminAlertsResponse (full drizzle row incl. dedupeKey)", async () => {
    const a = await seedAdmin();
    await seedAlert({ isRead: false, dedupeKey: "stock:contract-1" });
    await seedAlert({ isRead: true, message: null });
    const res = await call("GET", "/api/admin/alerts?page=1&limit=50", {
      adminToken: signAdminToken({ adminId: a.id, role: "admin" }),
    });
    expect(res.status).toBe(200);
    expectContract(ListAdminAlertsResponse, res.body);
  });

  it("GET /api/admin/alerts/unread-count → GetAdminAlertsUnreadCountResponse", async () => {
    const a = await seedAdmin();
    await seedAlert({ isRead: false });
    await seedAlert({ isRead: false });
    const res = await call("GET", "/api/admin/alerts/unread-count", {
      adminToken: signAdminToken({ adminId: a.id, role: "admin" }),
    });
    expect(res.status).toBe(200);
    expectContract(GetAdminAlertsUnreadCountResponse, res.body);
  });

  it("PATCH /api/admin/alerts/{id}/read → MarkAdminAlertReadResponse", async () => {
    const a = await seedAdmin();
    const alert = await seedAlert({ isRead: false });
    const res = await call("PATCH", `/api/admin/alerts/${alert.id}/read`, {
      adminToken: signAdminToken({ adminId: a.id, role: "admin" }),
    });
    expect(res.status).toBe(200);
    expectContract(MarkAdminAlertReadResponse, res.body);
  });

  it("PATCH /api/admin/alerts/read-all → MarkAllAdminAlertsReadResponse", async () => {
    const a = await seedAdmin();
    await seedAlert({ isRead: false });
    const res = await call("PATCH", "/api/admin/alerts/read-all", {
      adminToken: signAdminToken({ adminId: a.id, role: "admin" }),
    });
    expect(res.status).toBe(200);
    expectContract(MarkAllAdminAlertsReadResponse, res.body);
  });

  it("DELETE /api/admin/alerts/{id} → DeleteAdminAlertResponse", async () => {
    const a = await seedAdmin();
    const alert = await seedAlert({ isRead: true });
    const res = await call("DELETE", `/api/admin/alerts/${alert.id}`, {
      adminToken: signAdminToken({ adminId: a.id, role: "admin" }),
    });
    expect(res.status).toBe(200);
    expectContract(DeleteAdminAlertResponse, res.body);
  });

  it("DELETE /api/admin/alerts/read → DeleteReadAdminAlertsResponse (deleted count)", async () => {
    const a = await seedAdmin();
    await seedAlert({ isRead: true });
    await seedAlert({ isRead: false });
    const res = await call("DELETE", "/api/admin/alerts/read", {
      adminToken: signAdminToken({ adminId: a.id, role: "admin" }),
    });
    expect(res.status).toBe(200);
    expectContract(DeleteReadAdminAlertsResponse, res.body);
  });

  it("DELETE /api/admin/alerts → DeleteAllAdminAlertsResponse", async () => {
    const a = await seedAdmin();
    await seedAlert({ isRead: true });
    await seedAlert({ isRead: false });
    const res = await call("DELETE", "/api/admin/alerts", {
      adminToken: signAdminToken({ adminId: a.id, role: "admin" }),
    });
    expect(res.status).toBe(200);
    expectContract(DeleteAllAdminAlertsResponse, res.body);
  });

  it("GET /api/admin/tickets → ListAdminTicketsResponse (identity + reply stats row)", async () => {
    const a = await seedAdmin();
    await seedTicketWithReply();
    const res = await call("GET", "/api/admin/tickets", {
      adminToken: signAdminToken({ adminId: a.id, role: "admin" }),
    });
    expect(res.status).toBe(200);
    expectContract(ListAdminTicketsResponse, res.body);
  });

  it("GET /api/admin/tickets/{id} → GetAdminTicketResponse (thread envelope)", async () => {
    const a = await seedAdmin();
    const ticket = await seedTicketWithReply();
    const res = await call("GET", `/api/admin/tickets/${ticket.id}`, {
      adminToken: signAdminToken({ adminId: a.id, role: "admin" }),
    });
    expect(res.status).toBe(200);
    expectContract(GetAdminTicketResponse, res.body);
  });

  it("POST /api/admin/tickets/{id}/reply → 201 ReplyAdminTicketResponse", async () => {
    const a = await seedAdmin();
    const ticket = await seedTicketWithReply();
    const res = await call("POST", `/api/admin/tickets/${ticket.id}/reply`, {
      adminToken: signAdminToken({ adminId: a.id, role: "admin" }),
      body: { message: "رد فريق الدعم على التذكرة" },
    });
    expect(res.status).toBe(201);
    expectContract(ReplyAdminTicketResponse, res.body);
  });

  it("PATCH /api/admin/tickets/{id}/status → UpdateAdminTicketStatusResponse", async () => {
    const a = await seedAdmin();
    const ticket = await seedTicketWithReply();
    const res = await call("PATCH", `/api/admin/tickets/${ticket.id}/status`, {
      adminToken: signAdminToken({ adminId: a.id, role: "admin" }),
      body: { status: "closed" },
    });
    expect(res.status).toBe(200);
    expectContract(UpdateAdminTicketStatusResponse, res.body);
  });

  it("GET /api/admin/settings → GetAdminSettingsResponse (4 fixed fields)", async () => {
    const a = await seedAdmin();
    const res = await call("GET", "/api/admin/settings", {
      adminToken: signAdminToken({ adminId: a.id, role: "admin" }),
    });
    expect(res.status).toBe(200);
    expectContract(GetAdminSettingsResponse, res.body);
  });

  it("GET /api/admin/settings/auth → GetAdminAuthSettingsResponse (masked providers)", async () => {
    const a = await seedAdmin();
    const res = await call("GET", "/api/admin/settings/auth", {
      adminToken: signAdminToken({ adminId: a.id, role: "admin" }),
    });
    expect(res.status).toBe(200);
    expectContract(GetAdminAuthSettingsResponse, res.body);
  });

  it("GET /api/admin/chart-data → GetAdminChartDataResponse (zero-filled daily buckets)", async () => {
    const a = await seedAdmin();
    const res = await call("GET", "/api/admin/chart-data?days=7", {
      adminToken: signAdminToken({ adminId: a.id, role: "admin" }),
    });
    expect(res.status).toBe(200);
    expectContract(GetAdminChartDataResponse, res.body);
  });

  it("GET /api/admin/auth-stats/summary → GetAdminAuthStatsSummaryResponse (4 counts)", async () => {
    const a = await seedAdmin();
    await db
      .insert(authActivityTable)
      .values({ identifier: "0912345678", action: "login", success: true });
    const res = await call("GET", "/api/admin/auth-stats/summary", {
      adminToken: signAdminToken({ adminId: a.id, role: "admin" }),
    });
    expect(res.status).toBe(200);
    expectContract(GetAdminAuthStatsSummaryResponse, res.body);
  });

  it("GET /api/admin/auth-activity → ListAdminAuthActivityResponse (raw audit row)", async () => {
    const a = await seedAdmin();
    const u = await seedUser();
    await db.insert(authActivityTable).values({
      userId: u.id,
      identifier: "0912345678",
      action: "login",
      provider: "telegram",
      success: false,
      ipAddress: "41.208.0.1",
      userAgent: "contract-test-agent",
      failureReason: "انتهت صلاحية الجلسة",
    });
    const res = await call("GET", "/api/admin/auth-activity", {
      adminToken: signAdminToken({ adminId: a.id, role: "admin" }),
    });
    expect(res.status).toBe(200);
    expectContract(ListAdminAuthActivityResponse, res.body);
  });

  it("GET /api/admin/referrals → ListAdminReferralsResponse (stats + top + list)", async () => {
    const a = await seedAdmin();
    await seedReferralEvent("pending");
    await seedReferralEvent("credited");
    const res = await call("GET", "/api/admin/referrals", {
      adminToken: signAdminToken({ adminId: a.id, role: "admin" }),
    });
    expect(res.status).toBe(200);
    expectContract(ListAdminReferralsResponse, res.body);
  });
});

// ── admin batch-2 (R127-L1, B1 §4) — 10 newly-exposed endpoints ─────────────
//
// The top-cadence batch-2 exposure: the System tab's observability polls
// (metrics 15 s / summary 60 s / scheduler + alerts-recent 90 s), the
// runtime diagnostics snapshot, the layout-wide alerts/new delta, the
// risk review queue (dashboard aggregate + keyset events page), and the
// forecast family (at-risk panel + per-product drawer). Same honesty
// rule as batch-1: every schema was written field-by-field from the
// real handlers; these rows pin that against the real app.

async function seedRiskEvent(
  over: Partial<{
    userId: number | null;
    eventType: "login_failure" | "topup_attempt" | "order_create";
    score: number;
    level: "low" | "medium" | "high" | "critical";
    labeled: boolean;
  }> = {},
) {
  const u = over.userId === undefined ? (await seedUser()).id : over.userId;
  const [event] = await db
    .insert(riskEventsTable)
    .values({
      userId: u,
      eventType: over.eventType ?? "login_failure",
      score: over.score ?? 62,
      level: over.level ?? "high",
      confidence: "0.850",
      ruleFired: ["velocity_login"],
      actionTaken: "log",
      ipAddress: "41.208.0.9",
      createdAt: new Date(),
    })
    .returning();
  if (over.labeled) {
    await db.insert(riskLabelsTable).values({
      riskEventId: event.id,
      label: "false_positive",
      labeledAt: new Date(),
    });
  }
  return event;
}

async function seedForecastRun() {
  const [run] = await db
    .insert(inventoryForecastRunsTable)
    .values({
      startedAt: new Date(),
      completedAt: new Date(),
      outcome: "success",
      productsPredicted: 1,
    })
    .returning();
  return run;
}

describe("response contracts — admin batch-2 (R127-L1)", () => {
  it("GET /api/admin/observability/metrics → GetAdminObservabilityMetricsResponse (LKG envelope + snapshot)", async () => {
    const a = await seedAdmin();
    const res = await call("GET", "/api/admin/observability/metrics", {
      adminToken: signAdminToken({ adminId: a.id, role: "admin" }),
    });
    expect(res.status).toBe(200);
    expectContract(GetAdminObservabilityMetricsResponse, res.body);
  });

  it("GET /api/admin/observability/summary → GetAdminObservabilitySummaryResponse", async () => {
    const a = await seedAdmin();
    await seedAlert({ isRead: false });
    const res = await call("GET", "/api/admin/observability/summary", {
      adminToken: signAdminToken({ adminId: a.id, role: "admin" }),
    });
    expect(res.status).toBe(200);
    expectContract(GetAdminObservabilitySummaryResponse, res.body);
  });

  it("GET /api/admin/observability/scheduler → GetAdminObservabilitySchedulerResponse (heartbeat.note present without Redis)", async () => {
    const a = await seedAdmin();
    const res = await call("GET", "/api/admin/observability/scheduler", {
      adminToken: signAdminToken({ adminId: a.id, role: "admin" }),
    });
    expect(res.status).toBe(200);
    expectContract(GetAdminObservabilitySchedulerResponse, res.body);
  });

  it("GET /api/admin/observability/alerts/recent → GetAdminObservabilityAlertsRecentResponse (LKG envelope)", async () => {
    const a = await seedAdmin();
    await seedAlert({ isRead: false, dedupeKey: "stock:contract-b2" });
    const res = await call("GET", "/api/admin/observability/alerts/recent", {
      adminToken: signAdminToken({ adminId: a.id, role: "admin" }),
    });
    expect(res.status).toBe(200);
    expectContract(GetAdminObservabilityAlertsRecentResponse, res.body);
  });

  it("GET /api/admin/diagnostics → GetAdminDiagnosticsResponse (runtime snapshot)", async () => {
    const a = await seedAdmin();
    const res = await call("GET", "/api/admin/diagnostics", {
      adminToken: signAdminToken({ adminId: a.id, role: "admin" }),
    });
    expect(res.status).toBe(200);
    expectContract(GetAdminDiagnosticsResponse, res.body);
  });

  it("GET /api/admin/alerts/new → ListAdminNewAlertsResponse (since delta, raw drizzle rows)", async () => {
    const a = await seedAdmin();
    const older = await seedAlert({ isRead: true });
    await seedAlert({ isRead: false });
    const res = await call("GET", `/api/admin/alerts/new?since=${older.id}`, {
      adminToken: signAdminToken({ adminId: a.id, role: "admin" }),
    });
    expect(res.status).toBe(200);
    expectContract(ListAdminNewAlertsResponse, res.body);
  });

  it("GET /api/admin/risk/dashboard → GetAdminRiskDashboardResponse (window aggregates)", async () => {
    const a = await seedAdmin();
    await seedRiskEvent({ level: "high", labeled: false });
    await seedRiskEvent({ level: "low", labeled: true });
    const res = await call("GET", "/api/admin/risk/dashboard?hours=24", {
      adminToken: signAdminToken({ adminId: a.id, role: "admin" }),
    });
    expect(res.status).toBe(200);
    expectContract(GetAdminRiskDashboardResponse, res.body);
  });

  it("GET /api/admin/risk/events → ListAdminRiskEventsResponse (keyset page + cursor)", async () => {
    const a = await seedAdmin();
    await seedRiskEvent({ eventType: "topup_attempt", level: "critical" });
    await seedRiskEvent({ eventType: "login_failure", level: "medium", userId: null });
    const res = await call("GET", "/api/admin/risk/events?limit=1", {
      adminToken: signAdminToken({ adminId: a.id, role: "admin" }),
    });
    expect(res.status).toBe(200);
    expectContract(ListAdminRiskEventsResponse, res.body);
    // The keyset cursor rides on a full page — the opaque shape the
    // load-more consumer threads back verbatim.
    const body = res.body as { next_cursor: string | null };
    expect(typeof body.next_cursor).toBe("string");
  });

  it("GET /api/admin/forecast/at-risk → ListAdminForecastAtRiskResponse (panel rows + pipeline state)", async () => {
    const a = await seedAdmin();
    const p = await seedProduct();
    const run = await seedForecastRun();
    await db.insert(inventoryForecastsTable).values({
      runId: run.id,
      productId: p.id,
      forecastDate: "2026-10-01",
      currentStockOnHand: 5,
      avgDailySales: "2.5000",
      dowBlend7d: "1.1000",
      predictedDemand7d: 18,
      predictedDemand30d: 75,
      predictedRunoutAt: "2026-10-03",
      recommendedReorderQty: 40,
      confidence: "high",
      atRisk: true,
    });
    const res = await call("GET", "/api/admin/forecast/at-risk?limit=5", {
      adminToken: signAdminToken({ adminId: a.id, role: "admin" }),
    });
    expect(res.status).toBe(200);
    expectContract(ListAdminForecastAtRiskResponse, res.body);
  });

  it("GET /api/admin/forecast/products/{id} → GetAdminForecastProductResponse (detail + the null arm)", async () => {
    const a = await seedAdmin();
    const p = await seedProduct();
    const run = await seedForecastRun();
    await db.insert(inventoryForecastsTable).values({
      runId: run.id,
      productId: p.id,
      forecastDate: "2026-10-01",
      currentStockOnHand: 5,
      avgDailySales: "2.5000",
      dowBlend7d: "1.1000",
      predictedDemand7d: 18,
      predictedDemand30d: 75,
      predictedRunoutAt: "2026-10-03",
      recommendedReorderQty: 40,
      confidence: "high",
      atRisk: true,
    });
    const detail = await call("GET", `/api/admin/forecast/products/${p.id}`, {
      adminToken: signAdminToken({ adminId: a.id, role: "admin" }),
    });
    expect(detail.status).toBe(200);
    expectContract(GetAdminForecastProductResponse, detail.body);

    // The honest null arm — a product with no forecast row yet parses
    // against the SAME schema (forecast: null).
    const noRow = await call("GET", "/api/admin/forecast/products/999999", {
      adminToken: signAdminToken({ adminId: a.id, role: "admin" }),
    });
    expect(noRow.status).toBe(200);
    expectContract(GetAdminForecastProductResponse, noRow.body);
  });
});

// ── admin audit trail (R127-L5, B15-1) — row 49 ─────────────────────────────
//
// The audit_logs reader (GET /api/admin/audit-logs — the security
// page's «إجراءات المسؤولين» tab). The harness's audit_logs table
// (R116 DDL + TRUNCATE list) is seeded with both actor arms the
// schema documents: a console-admin row (actorId set → LEFT JOIN
// username) and the B11-F1 Telegram-webhook shape (actorId null,
// attribution in metadata). One row pins the envelope against the
// real app.

describe("response contracts — admin audit trail (R127-L5)", () => {
  it("GET /api/admin/audit-logs → ListAdminAuditLogsResponse (page envelope + both actor arms)", async () => {
    const a = await seedAdmin();
    await db.insert(auditLogsTable).values([
      {
        actorId: a.id,
        actorType: "admin",
        action: "topup.approve",
        targetType: "topup",
        targetId: 41,
        metadata: JSON.stringify({ admin_note: null, reviewed_by: "contract-admin" }),
        ip: "41.208.0.1",
      },
      {
        // B11-F1: the Telegram-webhook money path — no console admin id;
        // the actor lives in metadata.
        actorId: null,
        actorType: "admin",
        action: "topup.approve",
        targetType: "topup",
        targetId: 42,
        metadata: JSON.stringify({
          source: "telegram_webhook",
          actor: "@ops_manager",
          from_id: 111111,
        }),
        ip: "149.154.167.1",
      },
    ]);
    const res = await call("GET", "/api/admin/audit-logs?limit=1&page=1", {
      adminToken: signAdminToken({ adminId: a.id, role: "admin" }),
    });
    expect(res.status).toBe(200);
    expectContract(ListAdminAuditLogsResponse, res.body);
  });
});
