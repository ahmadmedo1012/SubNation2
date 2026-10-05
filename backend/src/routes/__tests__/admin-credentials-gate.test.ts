/**
 * R117 — admin credentials-reveal volume gate (A1-P4) + honest
 * decrypt-failure signal (A1-P6).
 *
 *  1. Volume gate: a per-admin sliding window (60 reveals / 10 min).
 *     The 61st reveal answers 429 RATE_LIMITED + Retry-After 300 while
 *     a DIFFERENT admin is unaffected (the window keys on admin id, not
 *     IP — the global apiLimiter is IP-keyed and never throttles a
 *     compromised admin session).
 *  2. decrypt_failed: when the raw columns are populated but every
 *     decrypt returns null (ENCRYPTION_KEY mismatch), the response
 *     carries decrypt_failed:true instead of masquerading as "no data".
 *
 * Same pglite mount harness as admin-orders-credentials.test.ts.
 */

import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

// Key A — encrypt the fixture order with this, then flip to key B to
// simulate an operator restoring a backup with the wrong key.
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? "aa".repeat(32);

import { encrypt, __resetEncryptionKeyCacheForTests } from "../../lib/encryption";
import { signAdminToken } from "../../lib/jwt";
import { adminOrdersRouter, __resetCredentialsViewGateForTests } from "../admin/orders";
import {
  adminUsersTable,
  db,
  initTestDb,
  ordersTable,
  productsTable,
  resetTestDb,
  usersTable,
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
  __resetCredentialsViewGateForTests();
  process.env.ENCRYPTION_KEY = "aa".repeat(32);
  __resetEncryptionKeyCacheForTests();
});

let phoneSeq = 91_800_000;
function nextPhone(): string {
  phoneSeq += 1;
  return String(phoneSeq);
}

async function seedAdmin(): Promise<{ token: string; id: number }> {
  const [a] = await db
    .insert(adminUsersTable)
    .values({
      username: `gate_admin_${Math.floor(Math.random() * 1e6)}`,
      passwordHash: "x",
      isActive: true,
      permissions: ["orders"],
    })
    .returning();
  return { token: signAdminToken({ adminId: a.id, role: "admin" }), id: a.id };
}

async function seedOrder(): Promise<number> {
  const [user] = await db
    .insert(usersTable)
    .values({ phone: nextPhone(), walletBalance: "100.00" })
    .returning();
  const [product] = await db
    .insert(productsTable)
    .values({ name: `P-${Math.floor(Math.random() * 1e6)}`, price: "30.00" })
    .returning();
  const [order] = await db
    .insert(ordersTable)
    .values({
      orderCode: `R117-${Math.floor(Math.random() * 1e6)}`,
      userId: user.id,
      productId: product.id,
      amount: "30.00",
      status: "completed",
      deliveredEmail: encrypt("buyer-account@test.local"),
      deliveredPassword: encrypt("SuperSecret123"),
      deliveredExtraDetails: null,
      deliveredAt: new Date(),
    })
    .returning();
  return order.id;
}

async function listen(): Promise<{ url: string; close: () => void }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") return reject(new Error("no addr"));
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        close: () => server.close(),
      });
    });
    server.on("error", reject);
  });
}

describe("R117 A1-P4 — credentials-reveal volume gate", () => {
  it("allows the budget, then 429s with Retry-After; a different admin is unaffected", async () => {
    const { url, close } = await listen();
    try {
      const orderId = await seedOrder();
      const adminA = await seedAdmin();
      const adminB = await seedAdmin();

      const reveal = async (token: string) =>
        fetch(`${url}/api/admin/orders/${orderId}/credentials`, {
          headers: { Authorization: `Bearer ${token}` },
        });

      // Admin A spends the whole budget (60).
      let lastOk: Response | null = null;
      for (let i = 0; i < 60; i++) {
        const r = await reveal(adminA.token);
        expect(r.status).toBe(200);
        lastOk = r;
      }
      // A clean 200 must NOT carry decrypt_failed (key matches).
      const body = (await lastOk!.json()) as Record<string, unknown>;
      expect(body.decrypt_failed).toBeUndefined();
      expect(body.has_credentials).toBe(true);
      expect(body.delivered_email).toBe("buyer-account@test.local");

      // The 61st reveal for the SAME admin is over budget.
      const blocked = await reveal(adminA.token);
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get("retry-after")).toBe("300");
      const blockedBody = (await blocked.json()) as Record<string, unknown>;
      expect(blockedBody.code).toBe("RATE_LIMITED");

      // A DIFFERENT admin is not poisoned by admin A's window.
      const other = await reveal(adminB.token);
      expect(other.status).toBe(200);
    } finally {
      close();
    }
  });
});

describe("R117 A1-P6 — decrypt_failed signal on ENCRYPTION_KEY mismatch", () => {
  it("reports decrypt_failed:true when columns are populated but every decrypt is null", async () => {
    const orderId = await seedOrder(); // encrypted with key A

    // Flip the key AFTER seeding — every safeDecrypt now fails GCM auth.
    process.env.ENCRYPTION_KEY = "bb".repeat(32);
    __resetEncryptionKeyCacheForTests();

    const { url, close } = await listen();
    try {
      const admin = await seedAdmin();
      const res = await fetch(`${url}/api/admin/orders/${orderId}/credentials`, {
        headers: { Authorization: `Bearer ${admin.token}` },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.has_credentials).toBe(true); // raw columns populated…
      expect(body.delivered_email).toBeNull(); // …but decrypts are null…
      expect(body.delivered_password).toBeNull();
      // …and the honest signal is present.
      expect(body.decrypt_failed).toBe(true);
    } finally {
      close();
    }
  });
});
