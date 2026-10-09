import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import {
  adminUsersTable,
  db,
  execTestSql,
  initTestDb,
  inventoryTable,
  productsTable,
  resetTestDb,
  supportTicketsTable,
  usersTable,
} from "../../test/db";
import { signAdminToken } from "../../lib/jwt";
import { requireAdmin } from "../../middlewares/requireAdmin";
import { requirePermission } from "../../lib/permissions";
import { adminTicketsRouter } from "../admin/tickets";
import { adminUsersRouter } from "../admin/users";
import { adminRiskRouter } from "../admin/risk";
import { adminProductsRouter } from "../admin/products";
import { adminProductVariantsRouter } from "../admin/product-variants";

/**
 * R125-I6 (I4 cross-lane handoff / A4-B-3 backend half): the
 * `admin-stats-update` socket emit — previously fired ONLY from
 * orders-bulk (admin/orders.ts) + topup approve/reject
 * (topup.service.ts) — now also fires from:
 *
 *   PATCH /api/admin/tickets/:id/status   {type:"ticket-status-update", status}
 *   POST  /api/admin/tickets/:id/reply    {type:"ticket-reply"}
 *   PATCH /api/admin/users/:id (wallet/   {type:"user-update"}
 *         loyalty edits that reach a mutation)
 *   POST  /api/admin/risk/events/:id/label       {type:"risk-label"}
 *   POST  /api/admin/risk/events/bulk-label      {type:"risk-bulk-label", applied}
 *
 * R126-L4 (A4-B2): the products family joins the emit set — commit
 * a8d688c's changelog CLAIMED products emits, but the R126 audit proved
 * products.ts had ZERO emitToAdmins hits. Product/variant/stock
 * mutations now emit too (second describe): create/update/archive,
 * inventory upload, set-count (only when surplus > 0), and the three
 * variant mutations. Same fire-and-forget idiom + mock harness.
 *
 * Same room (admin-room via emitToAdmins) and payload shape as the
 * orders-bulk emit; the frontend SocketInitializer handler ignores the
 * payload and prefix-invalidates the four admin families, so cross-tab
 * dashboards/lists refresh on event instead of waiting out staleTime.
 *
 * lib/socket is mocked at the module boundary (importOriginal spread —
 * only emitToAdmins is replaced; the real module no-ops without a live
 * io anyway) so the fire-and-forget dynamic-import chain in the routes
 * is observable. The emit is NOT awaited by the routes — assertions wait
 * via vi.waitFor.
 */

const { emitToAdminsMock } = vi.hoisted(() => ({ emitToAdminsMock: vi.fn() }));

vi.mock("../../lib/socket", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/socket")>();
  return { ...actual, emitToAdmins: emitToAdminsMock };
});

const RISK_DDL = `
CREATE TYPE risk_event_type AS ENUM (
  'login_attempt','login_success','login_failure','otp_request','otp_verify',
  'topup_attempt','topup_success','order_create','order_deliver','coupon_apply',
  'referral_event','admin_force_reauth');
CREATE TYPE risk_level AS ENUM ('low','medium','high','critical');
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
  action_taken varchar(20) NOT NULL DEFAULT 'log',
  ip_address varchar(45),
  user_agent varchar(256),
  created_at timestamptz NOT NULL DEFAULT now(),
  shown_at timestamptz
);
CREATE TYPE risk_label_kind AS ENUM ('confirmed_fraud','false_positive','escalated');
CREATE TABLE risk_labels (
  id serial PRIMARY KEY,
  risk_event_id integer REFERENCES risk_events(id) ON DELETE SET NULL,
  label risk_label_kind NOT NULL,
  labeled_by integer REFERENCES admin_users(id) ON DELETE SET NULL,
  labeled_at timestamptz NOT NULL DEFAULT now(),
  notes text
);
`;

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/admin", adminTicketsRouter, adminUsersRouter, adminRiskRouter);
  // R126-L4: products family — the production mount chain from
  // admin/index.ts:67-72 (requireAdmin + the `inventory` scope in front
  // of both routers; the tickets/users/risk mounts above ride their own
  // leaf-level requireAdmin).
  app.use(
    "/api/admin",
    requireAdmin,
    requirePermission("inventory"),
    adminProductsRouter,
    adminProductVariantsRouter,
  );
  return app;
}

async function listen(): Promise<{ url: string; close: () => void }> {
  const app = buildApp();
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("listener address is not AddressInfo"));
        return;
      }
      resolve({ url: `http://127.0.0.1:${addr.port}`, close: () => server.close() });
    });
  });
}

let adminSeq = 0;
async function seedAdmin(permissions: string[] = ["all"]): Promise<string> {
  adminSeq += 1;
  const [a] = await db
    .insert(adminUsersTable)
    .values({
      username: `emit_admin_${adminSeq}`,
      passwordHash: "x",
      isActive: true,
      permissions,
    })
    .returning();
  return signAdminToken({ adminId: a.id, role: "admin" });
}

let userSeq = 0;
async function seedUser(): Promise<number> {
  userSeq += 1;
  const [u] = await db
    .insert(usersTable)
    .values({ phone: `9461${String(userSeq).padStart(5, "0")}`, walletBalance: "0.00" })
    .returning();
  return u.id;
}

async function seedTicket(userId: number): Promise<number> {
  const [t] = await db
    .insert(supportTicketsTable)
    .values({ userId, title: "Emit pin", status: "open" })
    .returning();
  return t.id;
}

async function seedRiskEvents(n: number): Promise<number[]> {
  const ids: number[] = [];
  for (let i = 0; i < n; i++) {
    const [row] = await db
      .execute(
        sql`INSERT INTO risk_events (event_type, score, level, confidence)
            VALUES ('login_failure', 80, 'high', 0.9)
            RETURNING id`,
      )
      .then((r) => (Array.isArray(r) ? r : (r.rows ?? [])) as Array<{ id: number }>);
    ids.push(row.id);
  }
  return ids;
}

async function call(
  url: string,
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${url}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...((init.headers as Record<string, string>) ?? {}),
    },
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

beforeAll(async () => {
  await initTestDb();
  // execTestSql, not db.execute — multi-statement DDL goes through
  // pglite's exec path (the round-94 C5 rule).
  await execTestSql(RISK_DDL);
});

beforeEach(async () => {
  await resetTestDb();
  await db.execute(sql.raw("DELETE FROM risk_labels"));
  await db.execute(sql.raw("DELETE FROM risk_events"));
  emitToAdminsMock.mockClear();
});

describe("admin-stats-update emits — tickets/users/risk mutations (R125-I6, I4 handoff)", () => {
  it("PATCH /tickets/:id/status emits {type:'ticket-status-update', status} on success", async () => {
    const token = await seedAdmin();
    const userId = await seedUser();
    const ticketId = await seedTicket(userId);
    const { url, close } = await listen();
    try {
      const res = await call(url, `/api/admin/tickets/${ticketId}/status`, token, {
        method: "PATCH",
        body: JSON.stringify({ status: "closed" }),
      });
      expect(res.status).toBe(200);

      await vi.waitFor(() => expect(emitToAdminsMock).toHaveBeenCalledTimes(1));
      expect(emitToAdminsMock).toHaveBeenCalledWith("admin-stats-update", {
        type: "ticket-status-update",
        status: "closed",
      });
    } finally {
      close();
    }
  });

  it("POST /tickets/:id/reply emits {type:'ticket-reply'} on 201", async () => {
    const token = await seedAdmin();
    const userId = await seedUser();
    const ticketId = await seedTicket(userId);
    const { url, close } = await listen();
    try {
      const res = await call(url, `/api/admin/tickets/${ticketId}/reply`, token, {
        method: "POST",
        body: JSON.stringify({ message: "رد الاختبار" }),
      });
      expect(res.status).toBe(201);

      await vi.waitFor(() => expect(emitToAdminsMock).toHaveBeenCalledTimes(1));
      expect(emitToAdminsMock).toHaveBeenCalledWith("admin-stats-update", {
        type: "ticket-reply",
      });
    } finally {
      close();
    }
  });

  it("a failed ticket status flip (404) emits NOTHING — the emit rides success only", async () => {
    const token = await seedAdmin();
    const { url, close } = await listen();
    try {
      const res = await call(url, "/api/admin/tickets/999999/status", token, {
        method: "PATCH",
        body: JSON.stringify({ status: "closed" }),
      });
      expect(res.status).toBe(404);
      // Give the fire-and-forget chain a beat to (not) fire.
      await new Promise((r) => setImmediate(r));
      expect(emitToAdminsMock).not.toHaveBeenCalled();
    } finally {
      close();
    }
  });

  it("PATCH /users/:id wallet adjustment emits {type:'user-update'}", async () => {
    const token = await seedAdmin(["all"]);
    const userId = await seedUser();
    const { url, close } = await listen();
    try {
      const res = await call(url, `/api/admin/users/${userId}`, token, {
        method: "PATCH",
        body: JSON.stringify({ wallet_adjustment: 10, note: "emit pin adjustment" }),
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ wallet_balance: 10 });

      await vi.waitFor(() => expect(emitToAdminsMock).toHaveBeenCalledTimes(1));
      expect(emitToAdminsMock).toHaveBeenCalledWith("admin-stats-update", {
        type: "user-update",
      });
    } finally {
      close();
    }
  });

  it("POST /risk/events/:id/label emits {type:'risk-label'}", async () => {
    const token = await seedAdmin();
    const [eventId] = await seedRiskEvents(1);
    const { url, close } = await listen();
    try {
      const res = await call(url, `/api/admin/risk/events/${eventId}/label`, token, {
        method: "POST",
        body: JSON.stringify({ label: "false_positive" }),
      });
      expect(res.status).toBe(200);

      await vi.waitFor(() => expect(emitToAdminsMock).toHaveBeenCalledTimes(1));
      expect(emitToAdminsMock).toHaveBeenCalledWith("admin-stats-update", {
        type: "risk-label",
      });
    } finally {
      close();
    }
  });

  it("POST /risk/events/bulk-label emits {type:'risk-bulk-label', applied}", async () => {
    const token = await seedAdmin();
    const ids = await seedRiskEvents(2);
    const { url, close } = await listen();
    try {
      const res = await call(url, "/api/admin/risk/events/bulk-label", token, {
        method: "POST",
        body: JSON.stringify({ event_ids: ids, label: "escalated" }),
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ applied: 2 });

      await vi.waitFor(() => expect(emitToAdminsMock).toHaveBeenCalledTimes(1));
      expect(emitToAdminsMock).toHaveBeenCalledWith("admin-stats-update", {
        type: "risk-bulk-label",
        applied: 2,
      });
    } finally {
      close();
    }
  });
});

describe("admin-stats-update emits — products/variants/stock mutations (R126-L4, A4-B2)", () => {
  let productSeq = 0;
  async function seedProduct(): Promise<number> {
    productSeq += 1;
    const [p] = await db
      .insert(productsTable)
      .values({ name: `Emit Product ${productSeq}`, price: "25.00", isActive: true })
      .returning();
    return p.id;
  }

  it("POST /products emits {type:'product-create', product_id} on 201", async () => {
    const token = await seedAdmin(["inventory"]);
    const { url, close } = await listen();
    try {
      const res = await call(url, "/api/admin/products", token, {
        method: "POST",
        body: JSON.stringify({ name: "Emit Created", price: 19.5 }),
      });
      expect(res.status).toBe(201);
      const productId = (res.body as { id: number }).id;

      await vi.waitFor(() => expect(emitToAdminsMock).toHaveBeenCalledTimes(1));
      expect(emitToAdminsMock).toHaveBeenCalledWith("admin-stats-update", {
        type: "product-create",
        product_id: productId,
      });
    } finally {
      close();
    }
  });

  it("PATCH /products/:id emits {type:'product-update', product_id}", async () => {
    const token = await seedAdmin(["inventory"]);
    const productId = await seedProduct();
    const { url, close } = await listen();
    try {
      const res = await call(url, `/api/admin/products/${productId}`, token, {
        method: "PATCH",
        body: JSON.stringify({ name: "Emit Renamed" }),
      });
      expect(res.status).toBe(200);

      await vi.waitFor(() => expect(emitToAdminsMock).toHaveBeenCalledTimes(1));
      expect(emitToAdminsMock).toHaveBeenCalledWith("admin-stats-update", {
        type: "product-update",
        product_id: productId,
      });
    } finally {
      close();
    }
  });

  it("DELETE /products/:id (archive) emits {type:'product-archive', product_id}", async () => {
    const token = await seedAdmin(["inventory"]);
    const productId = await seedProduct();
    const { url, close } = await listen();
    try {
      const res = await call(url, `/api/admin/products/${productId}`, token, {
        method: "DELETE",
      });
      expect(res.status).toBe(200);

      await vi.waitFor(() => expect(emitToAdminsMock).toHaveBeenCalledTimes(1));
      expect(emitToAdminsMock).toHaveBeenCalledWith("admin-stats-update", {
        type: "product-archive",
        product_id: productId,
      });
    } finally {
      close();
    }
  });

  it("POST /products/:id/inventory (upload) emits {type:'product-inventory-upload', product_id, added}", async () => {
    const token = await seedAdmin(["inventory"]);
    const productId = await seedProduct();
    const { url, close } = await listen();
    try {
      const res = await call(url, `/api/admin/products/${productId}/inventory`, token, {
        method: "POST",
        body: JSON.stringify({
          entries: [
            { kind: "credentials", email: "emit1@x.com", password: "pw-one" },
            { kind: "code", extra: "EMIT-CODE-1" },
          ],
        }),
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ added: 2 });

      await vi.waitFor(() => expect(emitToAdminsMock).toHaveBeenCalledTimes(1));
      expect(emitToAdminsMock).toHaveBeenCalledWith("admin-stats-update", {
        type: "product-inventory-upload",
        product_id: productId,
        added: 2,
      });
    } finally {
      close();
    }
  });

  it("POST /products/:id/inventory/set-count emits {type:'product-stock-set-count', removed} when surplus > 0", async () => {
    const token = await seedAdmin(["inventory"]);
    const productId = await seedProduct();
    await db.insert(inventoryTable).values([
      { productId, accountEmail: "stock1@x.com", accountPassword: "p1" },
      { productId, accountEmail: "stock2@x.com", accountPassword: "p2" },
    ]);
    const { url, close } = await listen();
    try {
      const res = await call(url, `/api/admin/products/${productId}/inventory/set-count`, token, {
        method: "POST",
        body: JSON.stringify({ count: 1 }),
      });
      expect(res.status).toBe(200);

      await vi.waitFor(() => expect(emitToAdminsMock).toHaveBeenCalledTimes(1));
      expect(emitToAdminsMock).toHaveBeenCalledWith("admin-stats-update", {
        type: "product-stock-set-count",
        product_id: productId,
        removed: 1,
      });
    } finally {
      close();
    }
  });

  it("a NO-OP set-count (count == unsold) emits NOTHING — the emit rides actual change", async () => {
    const token = await seedAdmin(["inventory"]);
    const productId = await seedProduct();
    await db
      .insert(inventoryTable)
      .values({ productId, accountEmail: "noop@x.com", accountPassword: "p1" });
    const { url, close } = await listen();
    try {
      const res = await call(url, `/api/admin/products/${productId}/inventory/set-count`, token, {
        method: "POST",
        body: JSON.stringify({ count: 1 }),
      });
      expect(res.status).toBe(200);
      // Give the fire-and-forget chain a beat to (not) fire.
      await new Promise((r) => setImmediate(r));
      expect(emitToAdminsMock).not.toHaveBeenCalled();
    } finally {
      close();
    }
  });

  it("POST /products/:id/variants emits {type:'product-variant-create', product_id, variant_id}", async () => {
    const token = await seedAdmin(["inventory"]);
    const productId = await seedProduct();
    const { url, close } = await listen();
    try {
      const res = await call(url, `/api/admin/products/${productId}/variants`, token, {
        method: "POST",
        body: JSON.stringify({ plan_label: "شهر", cost_price: 10 }),
      });
      expect(res.status).toBe(201);
      const variantId = (res.body as { id: number }).id;

      await vi.waitFor(() => expect(emitToAdminsMock).toHaveBeenCalledTimes(1));
      expect(emitToAdminsMock).toHaveBeenCalledWith("admin-stats-update", {
        type: "product-variant-create",
        product_id: productId,
        variant_id: variantId,
      });
    } finally {
      close();
    }
  });

  it("a failed product mutation (archive 404) emits NOTHING — the emit rides success only", async () => {
    const token = await seedAdmin(["inventory"]);
    const { url, close } = await listen();
    try {
      const res = await call(url, "/api/admin/products/999999", token, { method: "DELETE" });
      expect(res.status).toBe(404);
      await new Promise((r) => setImmediate(r));
      expect(emitToAdminsMock).not.toHaveBeenCalled();
    } finally {
      close();
    }
  });
});
