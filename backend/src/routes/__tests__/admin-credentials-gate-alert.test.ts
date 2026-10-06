/**
 * R118-B5 bonus (A5 W-3) — the reveal-gate's DEDUPED admin alert.
 *
 * The R117 commit message for 8acba4a claims the over-budget 429 also
 * "raises a deduped admin alert naming the admin" — the gate suite
 * (admin-credentials-gate.test.ts) pins the 429/Retry-After/isolation
 * and the decrypt_failed signal, but NEVER asserts the alert write.
 * This suite closes that gap on the REAL mechanism (alertLogger's
 * keyed DB dedupe — dedupeKey `credentials-sweep:${adminId}`, 1 h
 * window, admin/orders.ts:332-337):
 *
 *   1. Repeated over-budget hits (61st…63rd reveal) insert EXACTLY ONE
 *      admin_alerts row for that admin — the dedupe window collapses
 *      the burst; zero rows for a different in-budget admin.
 *   2. The row is UNREAD (bell visibility), type system, and its
 *      message names the admin by username.
 *
 * Same pglite mount harness as admin-credentials-gate.test.ts.
 */

import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? "aa".repeat(32);

import { encrypt } from "../../lib/encryption";
import { signAdminToken } from "../../lib/jwt";
import { adminOrdersRouter, __resetCredentialsViewGateForTests } from "../admin/orders";
import {
  adminAlertsTable,
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
});

let phoneSeq = 91_900_000;
function nextPhone(): string {
  phoneSeq += 1;
  return String(phoneSeq);
}

async function seedAdmin(
  username: string,
): Promise<{ token: string; id: number; username: string }> {
  const [a] = await db
    .insert(adminUsersTable)
    .values({
      username,
      passwordHash: "x",
      isActive: true,
      permissions: ["orders"],
    })
    .returning();
  return { token: signAdminToken({ adminId: a.id, role: "admin" }), id: a.id, username };
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
      orderCode: `R118-${Math.floor(Math.random() * 1e6)}`,
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

/** The alerts table is GLOBAL (no admin_id column — the message text
 * names the admin); the dedupeKey is the per-admin discriminator:
 * `credentials-sweep:<adminId>` (admin/orders.ts:336). */
async function alertsByDedupeKey(
  key: string,
): Promise<Array<{ isRead: boolean; type: string; message: string | null }>> {
  return db
    .select({
      isRead: adminAlertsTable.isRead,
      type: adminAlertsTable.type,
      message: adminAlertsTable.message,
    })
    .from(adminAlertsTable)
    .where(eq(adminAlertsTable.dedupeKey, key));
}

describe("R118 (A5 W-3) — the reveal-gate over-budget path writes a DEDUPED admin alert", () => {
  it(
    "a burst of over-budget reveals collapses to exactly ONE unread alert naming the admin; an in-budget admin gets zero",
    { timeout: 30_000 },
    async () => {
      const { url, close } = await listen();
      try {
        const orderId = await seedOrder();
        const sweeper = await seedAdmin("sweeper_admin");
        const honest = await seedAdmin("honest_admin");

        const reveal = (token: string) =>
          fetch(`${url}/api/admin/orders/${orderId}/credentials`, {
            headers: { Authorization: `Bearer ${token}` },
          });

        // The sweeper blows the 60/10min budget, then keeps hammering —
        // three MORE over-budget hits, each of which fires the void
        // logAdminAlert(...) promise (admin/orders.ts:332).
        for (let i = 0; i < 60; i++) {
          const r = await reveal(sweeper.token);
          expect(r.status).toBe(200);
        }
        for (let i = 0; i < 3; i++) {
          const r = await reveal(sweeper.token);
          expect(r.status).toBe(429);
        }

        // The honest admin stays well inside the budget — no alert owed.
        const ok = await reveal(honest.token);
        expect(ok.status).toBe(200);

        // The alert writes are fire-and-forget (void … .catch) — poll the
        // table until the deduped row lands (pglite: single-digit ms).
        const sweeperKey = `credentials-sweep:${sweeper.id}`;
        await vi.waitFor(
          async () => {
            const rows = await alertsByDedupeKey(sweeperKey);
            expect(rows).toHaveLength(1);
          },
          { timeout: 5_000, interval: 25 },
        );

        const sweeperRows = await alertsByDedupeKey(sweeperKey);
        // EXACTLY one row survives the burst — the 1 h dedupeKey window
        // (credentials-sweep:<id>, alertLogger) collapses the 3 over-budget
        // hits into the first insert.
        expect(sweeperRows).toHaveLength(1);
        expect(sweeperRows[0]!.isRead).toBe(false); // bell-visible
        expect(sweeperRows[0]!.type).toBe("system");
        // The message names the admin by USERNAME (session compromise is
        // a human-investigation path — the id alone would send the
        // operator to a SQL console mid-incident).
        expect(sweeperRows[0]!.message).toContain("sweeper_admin");

        // The in-budget admin has no sweep alert keyed to them.
        expect(await alertsByDedupeKey(`credentials-sweep:${honest.id}`)).toHaveLength(0);
      } finally {
        close();
      }
    },
  );
});
