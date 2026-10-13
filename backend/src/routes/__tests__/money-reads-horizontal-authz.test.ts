import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  db,
  initTestDb,
  resetTestDb,
  ordersTable,
  pointsLedgerTable,
  productsTable,
  usersTable,
  walletLedgerTable,
  walletTopupsTable,
} from "../../test/db";
import { signUserToken } from "../../lib/jwt";
import { ordersRouter } from "../orders";
import { walletRouter } from "../wallet";
import { loyaltyRouter } from "../loyalty";

/**
 * R142 (H-1) — horizontal-authz regression tests for the four user
 * money-read surfaces.
 *
 * Every query on these routes is userId-scoped from the requireUser-
 * verified token, but nothing failed if a refactor dropped the
 * `eq(table.userId, userId)` predicate: order rows carry has_credentials
 * flags / totals / status, and the ledgers carry a user's full money
 * history — a dropped predicate is a silent P1 privacy breach that
 * ships green. Cart (404 for another user's row), sessions and
 * notifications already pin this test class; these four close the gap
 * for the money family.
 *
 * Shapes pinned per the route's ACTUAL contract:
 *   - GET /api/orders/:orderCode → scoped singleton → 404 ORDER_NOT_FOUND
 *     for a foreign orderCode (not 403 — the route answers "not found"
 *     so existence is not leaked);
 *   - GET /api/wallet/topups | /wallet/ledger | /loyalty/ledger → scoped
 *     LISTs → 200 with ONLY the caller's rows; a foreign user's rows
 *     never appear, and the caller's own rows still do (control leg).
 */

function buildApp(routers: Array<[string, express.Router]>): Express {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  for (const [path, router] of routers) app.use(path, router);
  return app;
}

async function listen(app: Express): Promise<{ url: string; close: () => void }> {
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

async function seedUser(phone: string): Promise<{ id: number; token: string }> {
  const [u] = await db.insert(usersTable).values({ phone, walletBalance: "100.00" }).returning();
  return { id: u.id, token: signUserToken({ userId: u.id }) };
}

async function getJson(
  url: string,
  token: string,
  query: string,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${url}${query}`, {
    headers: { Cookie: `auth_token=${token}` },
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

beforeAll(initTestDb, 60_000);
beforeEach(resetTestDb);

// ── GET /api/orders/:orderCode ──────────────────────────────────────────────
describe("H-1 — GET /api/orders/:orderCode horizontal authz", () => {
  it("user B gets 404 ORDER_NOT_FOUND for user A's orderCode (A still reads it)", async () => {
    const userA = await seedUser("963110001");
    const userB = await seedUser("963110002");
    const [p] = await db
      .insert(productsTable)
      .values({ name: "Authz Product", price: "12.00" })
      .returning();
    const [orderA] = await db
      .insert(ordersTable)
      .values({ orderCode: "AUTHZ-A-0001", userId: userA.id, productId: p.id, amount: "12.00" })
      .returning();

    const { url, close } = await listen(buildApp([["/api/orders", ordersRouter]]));
    try {
      // Control: the owner reads the row.
      const own = await getJson(url, userA.token, "/api/orders/AUTHZ-A-0001");
      expect(own.status).toBe(200);
      expect((own.body as { order_code: string }).order_code).toBe("AUTHZ-A-0001");

      // Foreign session → the scoped predicate drops the row → honest 404.
      const foreign = await getJson(url, userB.token, "/api/orders/AUTHZ-A-0001");
      expect(foreign.status).toBe(404);
      expect((foreign.body as { code: string }).code).toBe("ORDER_NOT_FOUND");
      expect(orderA.userId).toBe(userA.id);
    } finally {
      close();
    }
  });
});

// ── GET /api/wallet/topups ──────────────────────────────────────────────────
describe("H-1 — GET /api/wallet/topups horizontal authz", () => {
  it("user B's list never contains user A's topup (and still shows B's own)", async () => {
    const userA = await seedUser("963110003");
    const userB = await seedUser("963110004");
    const [topupA] = await db
      .insert(walletTopupsTable)
      .values({
        userId: userA.id,
        amount: "50.00",
        paymentMethod: "mobile_transfer",
        paymentNetwork: "madar",
        status: "approved" as const,
      })
      .returning();
    const [topupB] = await db
      .insert(walletTopupsTable)
      .values({
        userId: userB.id,
        amount: "7.00",
        paymentMethod: "mobile_transfer",
        paymentNetwork: "libyana",
        status: "approved" as const,
      })
      .returning();

    const { url, close } = await listen(buildApp([["/api/wallet", walletRouter]]));
    try {
      const asB = await getJson(url, userB.token, "/api/wallet/topups");
      expect(asB.status).toBe(200);
      const rowsB = asB.body as Array<{ id: number }>;
      expect(rowsB.map((r) => r.id)).toEqual([topupB.id]);
      expect(rowsB.some((r) => r.id === topupA.id)).toBe(false);

      // Control: A's own list has A's row and not B's.
      const asA = await getJson(url, userA.token, "/api/wallet/topups");
      const rowsA = asA.body as Array<{ id: number }>;
      expect(rowsA.map((r) => r.id)).toEqual([topupA.id]);
    } finally {
      close();
    }
  });
});

// ── GET /api/wallet/ledger ──────────────────────────────────────────────────
describe("H-1 — GET /api/wallet/ledger horizontal authz", () => {
  it("user B's statement never contains user A's ledger entries (and still shows B's)", async () => {
    const userA = await seedUser("963110005");
    const userB = await seedUser("963110006");
    const [entryA] = await db
      .insert(walletLedgerTable)
      .values({
        userId: userA.id,
        type: "topup" as const,
        amount: "50.00",
        balanceBefore: "0.00",
        balanceAfter: "50.00",
        referenceType: "topup",
      })
      .returning();
    const [entryB] = await db
      .insert(walletLedgerTable)
      .values({
        userId: userB.id,
        type: "topup" as const,
        amount: "7.00",
        balanceBefore: "0.00",
        balanceAfter: "7.00",
        referenceType: "topup",
      })
      .returning();

    const { url, close } = await listen(buildApp([["/api/wallet", walletRouter]]));
    try {
      const asB = await getJson(url, userB.token, "/api/wallet/ledger");
      expect(asB.status).toBe(200);
      const rowsB = asB.body as Array<{ id: number }>;
      expect(rowsB.map((r) => r.id)).toEqual([entryB.id]);
      expect(rowsB.some((r) => r.id === entryA.id)).toBe(false);

      const asA = await getJson(url, userA.token, "/api/wallet/ledger");
      const rowsA = asA.body as Array<{ id: number }>;
      expect(rowsA.map((r) => r.id)).toEqual([entryA.id]);
    } finally {
      close();
    }
  });
});

// ── GET /api/loyalty/ledger ─────────────────────────────────────────────────
describe("H-1 — GET /api/loyalty/ledger horizontal authz", () => {
  it("user B's points history never contains user A's entries (and still shows B's)", async () => {
    const userA = await seedUser("963110007");
    const userB = await seedUser("963110008");
    const [entryA] = await db
      .insert(pointsLedgerTable)
      .values({
        userId: userA.id,
        type: "purchase_award" as const,
        pointsDelta: 120,
        pointsBefore: 0,
        pointsAfter: 120,
      })
      .returning();
    const [entryB] = await db
      .insert(pointsLedgerTable)
      .values({
        userId: userB.id,
        type: "referral_credit" as const,
        pointsDelta: 50,
        pointsBefore: 0,
        pointsAfter: 50,
      })
      .returning();

    const { url, close } = await listen(buildApp([["/api/loyalty", loyaltyRouter]]));
    try {
      const asB = await getJson(url, userB.token, "/api/loyalty/ledger");
      expect(asB.status).toBe(200);
      const rowsB = asB.body as Array<{ id: number }>;
      expect(rowsB.map((r) => r.id)).toEqual([entryB.id]);
      expect(rowsB.some((r) => r.id === entryA.id)).toBe(false);

      const asA = await getJson(url, userA.token, "/api/loyalty/ledger");
      const rowsA = asA.body as Array<{ id: number }>;
      expect(rowsA.map((r) => r.id)).toEqual([entryA.id]);
    } finally {
      close();
    }
  });
});
