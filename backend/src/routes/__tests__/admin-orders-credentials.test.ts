/**
 * R116 backend trio — admin orders router:
 *
 *  1. B6-03 (credentials-on-demand):
 *     - GET /api/admin/orders NO LONGER decrypts the three AES-GCM
 *       credential columns — rows carry `has_credentials` only (the old
 *       shape ran up to 600 decrypts per list refresh).
 *     - GET /api/admin/orders/:id/credentials is the ONLY decrypt
 *       surface: auth-gated, 400 on non-integer ids, 404 on unknown,
 *       Cache-Control: no-store, ONE `order.credentials_view` audit row
 *       per reveal, and only the requested order's material.
 *  2. A6-01 (refund finance gate): bulk-status status="refunded" is a
 *     wallet-money write — an orders-scoped admin gets 403 (B1-3
 *     pattern from routes/admin/users.ts), an all-scope admin proceeds.
 *  3. A9-1 (durable order notifications): every admin-driven status
 *     change ALSO writes a notifications row (type "order", Arabic
 *     «طلبك {code} {label}», link /orders/{code}) alongside the
 *     transient socket emit.
 *
 * Runs against the REAL adminOrdersRouter over the pglite harness (same
 * mount pattern as admin-bulk-status-guard.test.ts).
 */

import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

// Set BEFORE the first encrypt/decrypt call (safeDecrypt reads the key
// lazily + memoizes at first use — B6-03/R116). 32-byte hex, test-only.
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? "55".repeat(32);

import { encrypt } from "../../lib/encryption";
import { signAdminToken } from "../../lib/jwt";
import { adminOrdersRouter } from "../admin/orders";
import {
  adminUsersTable,
  auditLogsTable,
  db,
  initTestDb,
  notificationsTable,
  ordersTable,
  productsTable,
  resetTestDb,
  usersTable,
  walletLedgerTable,
} from "../../test/db";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/admin", adminOrdersRouter);
  return app;
}

const app = buildApp();

beforeAll(async () => {
  await initTestDb();
});
beforeEach(async () => {
  await resetTestDb();
});

let phoneSeq = 91_700_000;
function nextPhone(): string {
  phoneSeq += 1;
  return String(phoneSeq);
}

async function seedAdmin(permissions: string[]): Promise<{ token: string; id: number }> {
  const [a] = await db
    .insert(adminUsersTable)
    .values({
      username: `admin_${permissions.join("-") || "none"}_${Math.floor(Math.random() * 1e6)}`,
      passwordHash: "x",
      isActive: true,
      permissions,
    })
    .returning();
  return { token: signAdminToken({ adminId: a.id, role: "admin" }), id: a.id };
}

interface SeedOpts {
  status?: "pending" | "completed" | "failed" | "refunded";
  encrypted?: boolean;
  email?: string;
  password?: string;
  extra?: string;
}

/** One user + product + order carrying credential columns. */
async function seedOrder(opts: SeedOpts = {}): Promise<{ orderId: number; orderCode: string; userId: number }> {
  const { status = "completed", encrypted = true } = opts;
  const email = opts.email ?? "buyer-account@test.local";
  const password = opts.password ?? "SuperSecret123";
  const extra = opts.extra ?? "RECOVERY-CODE-42";
  const [user] = await db
    .insert(usersTable)
    .values({ phone: nextPhone(), walletBalance: "100.00" })
    .returning();
  const [product] = await db
    .insert(productsTable)
    .values({ name: `P-${Math.floor(Math.random() * 1e6)}`, price: "30.00" })
    .returning();
  const orderCode = `R116-${Math.floor(Math.random() * 1e6)}`;
  const [order] = await db
    .insert(ordersTable)
    .values({
      orderCode,
      userId: user.id,
      productId: product.id,
      amount: "30.00",
      status,
      deliveredEmail: encrypted ? encrypt(email) : email,
      deliveredPassword: encrypted ? encrypt(password) : password,
      deliveredExtraDetails: encrypted ? encrypt(extra) : extra,
      deliveredAt: new Date(),
    })
    .returning();
  return { orderId: order.id, orderCode, userId: user.id };
}

async function listen(): Promise<{ url: string; close: () => void }> {
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

async function getJson(url: string, path: string, token?: string) {
  const res = await fetch(`${url}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
}

async function patch(url: string, path: string, token: string, body: unknown) {
  const res = await fetch(`${url}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

// ── 1. B6-03: list shape + credentials-on-demand endpoint ───────────────────

describe("B6-03: GET /api/admin/orders — has_credentials list shape", () => {
  it("returns has_credentials and ships NO decrypted credential material", async () => {
    const { url, close } = await listen();
    try {
      const { token } = await seedAdmin(["orders"]);
      const { orderId } = await seedOrder();

      const res = await getJson(url, "/api/admin/orders?limit=10", token);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      const row = res.body[0];
      expect(row.id).toBe(orderId);
      expect(row.has_credentials).toBe(true);
      // The three decrypted fields are GONE from the list shape — not
      // null-shadowed, absent (and no ciphertext either).
      expect(row).not.toHaveProperty("delivered_email");
      expect(row).not.toHaveProperty("delivered_password");
      expect(row).not.toHaveProperty("delivered_extra_details");
      expect(JSON.stringify(row)).not.toContain("buyer-account@test.local");
      expect(JSON.stringify(row)).not.toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
    } finally {
      close();
    }
  });
});

describe("B6-03: GET /api/admin/orders/:id/credentials — the only decrypt surface", () => {
  it("auth-gated: no admin token → 401", async () => {
    const { url, close } = await listen();
    try {
      const { orderId } = await seedOrder();
      const res = await getJson(url, `/api/admin/orders/${orderId}/credentials`);
      expect(res.status).toBe(401);
    } finally {
      close();
    }
  });

  it("non-integer id → 400 (digit-exact strict parse)", async () => {
    const { url, close } = await listen();
    try {
      const { token } = await seedAdmin(["orders"]);
      for (const bad of ["abc", "-5", "12abc", "1.5"]) {
        const res = await getJson(url, `/api/admin/orders/${bad}/credentials`, token);
        expect(res.status).toBe(400);
      }
    } finally {
      close();
    }
  });

  it("unknown order id → 404 (and NO audit row — nothing was revealed)", async () => {
    const { url, close } = await listen();
    try {
      const { token } = await seedAdmin(["orders"]);
      const res = await getJson(url, "/api/admin/orders/999999/credentials", token);
      expect(res.status).toBe(404);
      expect(await db.select().from(auditLogsTable)).toHaveLength(0);
    } finally {
      close();
    }
  });

  it("happy path: decrypts ONLY the requested order, no-store, one audit row", async () => {
    const { url, close } = await listen();
    try {
      const { token } = await seedAdmin(["orders"]);
      const a = await seedOrder({
        email: "order-a@test.local",
        password: "pw-for-a",
        extra: "EXTRA-A",
      });
      const b = await seedOrder({
        email: "order-b@test.local",
        password: "pw-for-b",
        extra: "EXTRA-B",
      });

      const res = await getJson(url, `/api/admin/orders/${a.orderId}/credentials`, token);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.body).toMatchObject({
        id: a.orderId,
        order_code: a.orderCode,
        status: "completed",
        has_credentials: true,
        delivered_email: "order-a@test.local",
        delivered_password: "pw-for-a",
        delivered_extra_details: "EXTRA-A",
      });
      // Only THAT order: order B's material appears nowhere in the body.
      const serialized = JSON.stringify(res.body);
      expect(serialized).not.toContain("order-b@test.local");
      expect(serialized).not.toContain("pw-for-b");
      expect(serialized).not.toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);

      // Exactly ONE audit row — action order.credentials_view, target = the
      // revealed order, actor = the acting admin.
      const auditRows = await db.select().from(auditLogsTable);
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0].action).toBe("order.credentials_view");
      expect(auditRows[0].targetType).toBe("order");
      expect(auditRows[0].targetId).toBe(a.orderId);

      // A second reveal of the SAME order writes a SECOND audit row (each
      // reveal is individually attributable) but still never touches B.
      const again = await getJson(url, `/api/admin/orders/${a.orderId}/credentials`, token);
      expect(again.status).toBe(200);
      expect(await db.select().from(auditLogsTable)).toHaveLength(2);
    } finally {
      close();
    }
  });

  it("legacy plaintext rows pass through unchanged (B2-11 passthrough)", async () => {
    const { url, close } = await listen();
    try {
      const { token } = await seedAdmin(["orders"]);
      const { orderId } = await seedOrder({
        encrypted: false,
        email: "legacy@test.local",
        password: "legacy-pw",
      });

      const res = await getJson(url, `/api/admin/orders/${orderId}/credentials`, token);
      expect(res.status).toBe(200);
      expect(res.body.delivered_email).toBe("legacy@test.local");
      expect(res.body.delivered_password).toBe("legacy-pw");
    } finally {
      close();
    }
  });

  it("order without credentials → has_credentials:false + all nulls", async () => {
    const { url, close } = await listen();
    try {
      const { token } = await seedAdmin(["orders"]);
      const { orderId } = await seedOrder();
      await db
        .update(ordersTable)
        .set({
          deliveredEmail: null,
          deliveredPassword: null,
          deliveredExtraDetails: null,
        })
        .where(eq(ordersTable.id, orderId));

      const res = await getJson(url, `/api/admin/orders/${orderId}/credentials`, token);
      expect(res.status).toBe(200);
      expect(res.body.has_credentials).toBe(false);
      expect(res.body.delivered_email).toBeNull();
      expect(res.body.delivered_password).toBeNull();
      expect(res.body.delivered_extra_details).toBeNull();
    } finally {
      close();
    }
  });
});

// ── 2. A6-01: bulk refund finance gate ──────────────────────────────────────

describe("A6-01: PATCH /api/admin/orders/bulk-status — refund requires the finance scope", () => {
  it("orders-scoped admin → 403 BEFORE any refund work (no ledger, no notification)", async () => {
    const { url, close } = await listen();
    try {
      const { token } = await seedAdmin(["orders"]);
      const { orderId } = await seedOrder(); // completed → refundable

      const res = await patch(url, "/api/admin/orders/bulk-status", token, {
        ids: [orderId],
        status: "refunded",
      });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("FORBIDDEN");
      // Money untouched, nothing notified, nothing audited.
      expect(await db.select().from(walletLedgerTable)).toHaveLength(0);
      expect(await db.select().from(notificationsTable)).toHaveLength(0);
      expect(
        await db.select({ id: ordersTable.id }).from(ordersTable).where(eq(ordersTable.status, "refunded")),
      ).toHaveLength(0);
    } finally {
      close();
    }
  });

  it("all-scope admin proceeds past the gate (completed order actually refunds)", async () => {
    const { url, close } = await listen();
    try {
      const { token } = await seedAdmin(["all"]);
      const { orderId } = await seedOrder();

      const res = await patch(url, "/api/admin/orders/bulk-status", token, {
        ids: [orderId],
        status: "refunded",
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true, updated: 1 });
      expect(await db.select().from(walletLedgerTable)).toHaveLength(1);
    } finally {
      close();
    }
  });

  it("non-refund transitions stay available to the orders-scoped admin (the gate is refund-only)", async () => {
    const { url, close } = await listen();
    try {
      const { token } = await seedAdmin(["orders"]);
      const { orderId } = await seedOrder({ status: "pending" });

      const res = await patch(url, "/api/admin/orders/bulk-status", token, {
        ids: [orderId],
        status: "failed",
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true, updated: 1 });
    } finally {
      close();
    }
  });
});

// ── 3. A9-1: durable order-status notifications ────────────────────────────

describe("A9-1: durable order notifications alongside the socket emit", () => {
  it("non-refund transition writes a notifications row (type order, Arabic title, /orders/{code} link)", async () => {
    const { url, close } = await listen();
    try {
      const { token } = await seedAdmin(["orders"]);
      const { orderId, orderCode, userId } = await seedOrder({ status: "pending" });

      const res = await patch(url, "/api/admin/orders/bulk-status", token, {
        ids: [orderId],
        status: "failed",
      });
      expect(res.status).toBe(200);

      const rows = await db.select().from(notificationsTable);
      expect(rows).toHaveLength(1);
      expect(rows[0].userId).toBe(userId);
      expect(rows[0].type).toBe("order");
      expect(rows[0].title).toBe(`طلبك ${orderCode} فشل`);
      expect(rows[0].link).toBe(`/orders/${orderCode}`);
    } finally {
      close();
    }
  });

  it("refund transition writes «تم استرداده» and does not break the refund result", async () => {
    const { url, close } = await listen();
    try {
      const { token } = await seedAdmin(["all"]);
      const { orderId, orderCode, userId } = await seedOrder({ status: "completed" });

      const res = await patch(url, "/api/admin/orders/bulk-status", token, {
        ids: [orderId],
        status: "refunded",
      });
      expect(res.status).toBe(200);

      const rows = await db.select().from(notificationsTable);
      expect(rows).toHaveLength(1);
      expect(rows[0].userId).toBe(userId);
      expect(rows[0].title).toBe(`طلبك ${orderCode} تم استرداده`);
      expect(rows[0].link).toBe(`/orders/${orderCode}`);
    } finally {
      close();
    }
  });

  it("skipped orders (guarded/no-op ids) notify nobody", async () => {
    const { url, close } = await listen();
    try {
      const { token } = await seedAdmin(["orders"]);
      // completed → pending is blocked by the F2 guard: updated 0, no rows
      // transitioned, therefore no notification.
      const { orderId } = await seedOrder({ status: "completed" });

      const res = await patch(url, "/api/admin/orders/bulk-status", token, {
        ids: [orderId],
        status: "pending",
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ updated: 0, skipped_completed_source: 1 });
      expect(await db.select().from(notificationsTable)).toHaveLength(0);
    } finally {
      close();
    }
  });
});
