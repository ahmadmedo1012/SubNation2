import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  adminUsersTable,
  db,
  initTestDb,
  notificationsTable,
  ordersTable,
  productsTable,
  resetTestDb,
  usersTable,
} from "../../test/db";
import { signAdminToken } from "../../lib/jwt";
import { adminOrdersRouter } from "../admin/orders";

/**
 * F-9 (R118-A6) — bulk-status notification batching regression suite.
 *
 * The bulk flip used to `await notifyOrderStatusChanged(...)` once per
 * flipped order — N sequential single-row INSERTs (≤200 by the B2-F4
 * clamp) at ~100 ms RTT each against the far DB (a 200-order batch was
 * ≈ 20 s of pure insert latency). The batch now lands in ONE multi-row
 * INSERT (notifyOrderStatusChangedBatch) with the socket emits fired
 * after.
 *
 * Pinned here:
 *   - a 3-order bulk flip issues EXACTLY ONE insert into notifications
 *     (not 3), carrying all 3 rows;
 *   - the rows keep the A9-1 (R116) contract per buyer: type "order",
 *     the Arabic status-labeled title, the /orders/:orderCode link;
 *   - the route response + status flips are unchanged.
 *
 * The refund path's deliberately-sequential loop is NOT touched by the
 * fix (per-order atomic money op — see admin/orders.ts) and is not
 * re-pinned here.
 */

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/admin", adminOrdersRouter);
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

async function seedAdmin(): Promise<string> {
  const [a] = await db
    .insert(adminUsersTable)
    .values({ username: "admin_notify_batch", passwordHash: "x", isActive: true })
    .returning();
  return signAdminToken({ adminId: a.id, role: "admin" });
}

let userSeq = 0;
let codeSeq = 0;
async function seedPendingOrder(): Promise<{ id: number; userId: number; orderCode: string }> {
  userSeq += 1;
  codeSeq += 1;
  const [u] = await db
    .insert(usersTable)
    .values({ phone: `9460${String(userSeq).padStart(5, "0")}`, walletBalance: "0.00" })
    .returning();
  const [p] = await db.insert(productsTable).values({ name: "P", price: "5.00" }).returning();
  const [o] = await db
    .insert(ordersTable)
    .values({
      orderCode: `SNNB1B${String(codeSeq).padStart(6, "0")}`,
      userId: u.id,
      productId: p.id,
      amount: "5.00",
      status: "pending",
    })
    .returning();
  return { id: o.id, userId: u.id, orderCode: o.orderCode };
}

beforeAll(async () => {
  await initTestDb();
});

beforeEach(async () => {
  await resetTestDb();
});

describe("PATCH /api/admin/orders/bulk-status — batched buyer notifications (F-9, R118-A6)", () => {
  it("flipping 3 orders issues ONE notifications insert (not 3) carrying all 3 rows with the A9-1 contract", async () => {
    const { url, close } = await listen(buildApp());
    const insertSpy = vi.spyOn(db, "insert");
    try {
      const token = await seedAdmin();
      const seeded = [await seedPendingOrder(), await seedPendingOrder(), await seedPendingOrder()];

      const res = await fetch(`${url}/api/admin/orders/bulk-status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ids: seeded.map((s) => s.id), status: "failed" }),
      });
      const body = (await res.json()) as { success: boolean; updated: number };

      expect(res.status).toBe(200);
      expect(body).toMatchObject({ success: true, updated: 3 });

      // THE regression assertion: exactly ONE insert call targeted the
      // notifications table (the old loop made 3). Other inserts in the
      // request lifecycle (audit_logs via writeAuditLog) are filtered by
      // table identity.
      const notifInsertCalls = insertSpy.mock.calls.filter(
        (call) => call[0] === notificationsTable,
      );
      expect(notifInsertCalls).toHaveLength(1);

      // All 3 durable rows landed, one per buyer, with the A9-1 shape:
      // type "order" + the Arabic status-labeled title + the storefront
      // order-detail link.
      const rows = await db.select().from(notificationsTable);
      expect(rows).toHaveLength(3);
      expect(rows.every((r) => r.type === "order")).toBe(true);
      expect(rows.every((r) => r.isRead === false)).toBe(true);
      const byUser = new Map(rows.map((r) => [r.userId, r]));
      for (const s of seeded) {
        const row = byUser.get(s.userId);
        expect(row, `buyer ${s.userId} must have a notification row`).toBeDefined();
        expect(row?.title).toBe(`طلبك ${s.orderCode} فشل`);
        expect(row?.link).toBe(`/orders/${s.orderCode}`);
      }

      // The flips themselves are unaffected.
      const flipped = await db
        .select({ id: ordersTable.id, status: ordersTable.status })
        .from(ordersTable);
      expect(flipped.every((o) => o.status === "failed")).toBe(true);
    } finally {
      insertSpy.mockRestore();
      close();
    }
  });

  it("a bulk flip that transitions ZERO orders writes no notification rows at all", async () => {
    const { url, close } = await listen(buildApp());
    const insertSpy = vi.spyOn(db, "insert");
    try {
      const token = await seedAdmin();
      const seeded = [await seedPendingOrder()];

      // completed is purchase-tx-only: a pending order is skipped, so
      // flippedRows is empty and the batch helper must no-op.
      const res = await fetch(`${url}/api/admin/orders/bulk-status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ids: seeded.map((s) => s.id), status: "completed" }),
      });
      const body = (await res.json()) as { updated: number; skipped_blocked_completion: number };

      expect(res.status).toBe(200);
      expect(body).toMatchObject({ updated: 0, skipped_blocked_completion: 1 });
      expect(
        insertSpy.mock.calls.filter((call) => call[0] === notificationsTable),
      ).toHaveLength(0);
      expect(await db.select().from(notificationsTable)).toHaveLength(0);
    } finally {
      insertSpy.mockRestore();
      close();
    }
  });
});
