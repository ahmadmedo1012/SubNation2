import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  adminUsersTable,
  db,
  initTestDb,
  resetTestDb,
  ordersTable,
  productsTable,
  usersTable,
  walletLedgerTable,
} from "../../test/db";
import { signAdminToken } from "../../lib/jwt";
import { adminOrdersRouter } from "../admin/orders";

/**
 * F3 (round-94 A4): bulk-status used to allow `failed/pending →
 * completed`, after which a refund credited the wallet with no matching
 * purchase debit (credit-without-charge via admin surface). r4 F-1
 * closed the adjacent `refunded → completed` hole; this suite pins the
 * new guard: completed is purchase-tx-only, and the response reports
 * the skipped rows honestly (skipped_blocked_completion /
 * COMPLETED_IS_PURCHASE_ONLY) like the refunded guard does.
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
    .values({ username: "admin_bulk", passwordHash: "x", isActive: true })
    .returning();
  return signAdminToken({ adminId: a.id, role: "admin" });
}

let userSeq = 0;
let codeSeq = 0;
async function seedOrder(status: "pending" | "completed" | "failed" | "refunded"): Promise<number> {
  userSeq += 1;
  codeSeq += 1;
  const [u] = await db
    .insert(usersTable)
    .values({ phone: `9450${String(userSeq).padStart(5, "0")}`, walletBalance: "0.00" })
    .returning();
  const [p] = await db.insert(productsTable).values({ name: "P", price: "5.00" }).returning();
  const [o] = await db
    .insert(ordersTable)
    .values({
      orderCode: `SNBULK${String(codeSeq).padStart(6, "0")}`,
      userId: u.id,
      productId: p.id,
      amount: "5.00",
      status,
    })
    .returning();
  return o.id;
}

async function statuses(ids: number[]): Promise<Map<number, string>> {
  const rows = await db
    .select({ id: ordersTable.id, status: ordersTable.status })
    .from(ordersTable)
    .where(inArray(ordersTable.id, ids));
  return new Map(rows.map((r) => [r.id, r.status]));
}

async function patch(url: string, token: string, body: unknown) {
  const res = await fetch(`${url}/api/admin/orders/bulk-status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

beforeAll(async () => {
  await initTestDb();
});

beforeEach(async () => {
  await resetTestDb();
});

describe("PATCH /api/admin/orders/bulk-status — completed-is-purchase-only guard (F3)", () => {
  it("refuses failed → completed (the credit-without-debit hole) and reports it honestly", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const token = await seedAdmin();
      const failedId = await seedOrder("failed");

      const res = await patch(url, token, { ids: [failedId], status: "completed" });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        success: true,
        updated: 0,
        skipped_blocked_completion: 1,
        reason: "COMPLETED_IS_PURCHASE_ONLY",
      });
      expect((await statuses([failedId])).get(failedId)).toBe("failed");
      expect(await db.select({ id: walletLedgerTable.id }).from(walletLedgerTable)).toHaveLength(0);
    } finally {
      close();
    }
  });

  it("refuses pending → completed the same way", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const token = await seedAdmin();
      const pendingId = await seedOrder("pending");

      const res = await patch(url, token, { ids: [pendingId], status: "completed" });
      expect(res.body).toMatchObject({ updated: 0, skipped_blocked_completion: 1 });
      expect((await statuses([pendingId])).get(pendingId)).toBe("pending");
    } finally {
      close();
    }
  });

  it("refunded → completed is still refused (r4 F-1 regression, now via the same guard)", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const token = await seedAdmin();
      const refundedId = await seedOrder("refunded");

      const res = await patch(url, token, { ids: [refundedId], status: "completed" });
      expect(res.body).toMatchObject({
        updated: 0,
        skipped_refunded: 1,
        reason: "REFUNDED_IS_TERMINAL",
      });
      expect((await statuses([refundedId])).get(refundedId)).toBe("refunded");
    } finally {
      close();
    }
  });

  it("re-affirming already-completed orders is the idempotent no-op that still works", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const token = await seedAdmin();
      const completedId = await seedOrder("completed");

      const res = await patch(url, token, { ids: [completedId], status: "completed" });
      expect(res.body).toMatchObject({ success: true, updated: 1 });
      expect((await statuses([completedId])).get(completedId)).toBe("completed");
    } finally {
      close();
    }
  });

  it("mixed batch: completed re-affirmed, failed blocked — counts are per-reason", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const token = await seedAdmin();
      const completedId = await seedOrder("completed");
      const failedId = await seedOrder("failed");

      const res = await patch(url, token, { ids: [completedId, failedId], status: "completed" });
      expect(res.body).toMatchObject({
        updated: 1,
        skipped_blocked_completion: 1,
        reason: "COMPLETED_IS_PURCHASE_ONLY",
      });
    } finally {
      close();
    }
  });

  it("non-completed targets keep the refunded-only guard (completed → failed stays allowed)", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const token = await seedAdmin();
      const completedId = await seedOrder("completed");
      const refundedId = await seedOrder("refunded");

      const res = await patch(url, token, { ids: [completedId, refundedId], status: "failed" });
      expect(res.body).toMatchObject({ updated: 1, skipped_refunded: 1 });
      expect((await statuses([completedId])).get(completedId)).toBe("failed");
      expect((await statuses([refundedId])).get(refundedId)).toBe("refunded");
    } finally {
      close();
    }
  });
});
