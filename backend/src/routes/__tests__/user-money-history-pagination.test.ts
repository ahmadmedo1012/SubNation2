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
 * R120-B6/A6-F1 — the four user money-history lists were hard-capped at
 * their first page with NO page parameter: orders (cap 200), wallet
 * topups (fixed 200), wallet ledger (cap 200) and the loyalty points
 * ledger (cap 200) all made rows 201+ permanently unreachable. The fix
 * is an additive `?page=` (the admin/orders.ts:213-217 clamp idiom,
 * offset = (page-1)*limit) — the default (page=1, offset 0) must stay
 * byte-identical for every existing caller.
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

let phoneSeq = 96_200_000;
async function seedUser(): Promise<{ id: number; token: string }> {
  phoneSeq += 1;
  const [u] = await db
    .insert(usersTable)
    .values({ phone: String(phoneSeq), walletBalance: "500.00" })
    .returning();
  return { id: u.id, token: signUserToken({ userId: u.id }) };
}

/** Deterministic descending-by-created_at history: oldest row is 1000ms ago. */
function createdAtFor(i: number, total: number): Date {
  return new Date(Date.now() - (total - i) * 1000);
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

// ── GET /api/orders ─────────────────────────────────────────────────────────
describe("A6-F1 — GET /api/orders pagination", () => {
  const TOTAL = 205;

  it("page=2 walks past the 200-row cap (rows 201+ were unreachable)", async () => {
    const user = await seedUser();
    const [p] = await db
      .insert(productsTable)
      .values({ name: "Pagination Product", price: "5.00" })
      .returning();
    await db.insert(ordersTable).values(
      Array.from({ length: TOTAL }, (_, i) => ({
        orderCode: `PAGE-ORD-${String(i).padStart(4, "0")}`,
        userId: user.id,
        productId: p.id,
        amount: "5.00",
        createdAt: createdAtFor(i, TOTAL),
      })),
    );
    const { url, close } = await listen(buildApp([["/api/orders", ordersRouter]]));
    try {
      const first = await getJson(url, user.token, "/api/orders");
      expect((first.body as unknown[]).length).toBe(200); // cap unchanged

      const second = await getJson(url, user.token, "/api/orders?page=2");
      const rows = second.body as Array<{ order_code: string }>;
      expect(second.status).toBe(200);
      expect(rows.length).toBe(5); // rows 201..205 — the previously unreachable tail
      // Newest-first: position 201 = index 4 (the 5th-oldest row).
      expect(rows[0].order_code).toBe("PAGE-ORD-0004");
      expect(rows[4].order_code).toBe("PAGE-ORD-0000");

      // page=1 is the explicit default — byte-identical to no params.
      const explicit = await getJson(url, user.token, "/api/orders?page=1");
      expect(explicit.body).toStrictEqual(first.body);

      // page past the end → empty array, not an error.
      const beyond = await getJson(url, user.token, "/api/orders?page=99");
      expect(beyond.status).toBe(200);
      expect(beyond.body).toStrictEqual([]);

      // The clamp idiom: garbage / 0 / negative page → page 1.
      for (const q of ["?page=abc", "?page=0", "?page=-3"]) {
        const clamped = await getJson(url, user.token, `/api/orders${q}`);
        expect(clamped.body).toStrictEqual(first.body);
      }
    } finally {
      close();
    }
  });
});

// ── GET /api/wallet/topups ──────────────────────────────────────────────────
describe("A6-F1 — GET /api/wallet/topups pagination", () => {
  const TOTAL = 205;

  it("page=2 exposes the 5 oldest topups beyond the fixed 200 cap", async () => {
    const user = await seedUser();
    await db.insert(walletTopupsTable).values(
      Array.from({ length: TOTAL }, (_, i) => ({
        userId: user.id,
        amount: "20.00",
        paymentMethod: "mobile_transfer",
        paymentNetwork: "madar",
        status: "approved" as const,
        createdAt: createdAtFor(i, TOTAL),
      })),
    );
    const { url, close } = await listen(buildApp([["/api/wallet", walletRouter]]));
    try {
      const first = await getJson(url, user.token, "/api/wallet/topups");
      expect((first.body as unknown[]).length).toBe(200);

      const second = await getJson(url, user.token, "/api/wallet/topups?page=2");
      const rows = second.body as Array<{ id: number }>;
      expect(rows.length).toBe(5);

      const explicit = await getJson(url, user.token, "/api/wallet/topups?page=1");
      expect(explicit.body).toStrictEqual(first.body);
    } finally {
      close();
    }
  });
});

// ── GET /api/wallet/ledger ──────────────────────────────────────────────────
describe("A6-F1 — GET /api/wallet/ledger pagination", () => {
  const TOTAL = 205;

  it("page=3 (default limit 100) reaches rows 201+; page=1 default identical", async () => {
    const user = await seedUser();
    await db.insert(walletLedgerTable).values(
      Array.from({ length: TOTAL }, (_, i) => ({
        userId: user.id,
        type: "topup" as const,
        amount: "20.00",
        balanceBefore: "0.00",
        balanceAfter: "20.00",
        referenceType: "topup",
        referenceId: i + 1,
        createdAt: createdAtFor(i, TOTAL),
      })),
    );
    const { url, close } = await listen(buildApp([["/api/wallet", walletRouter]]));
    try {
      const first = await getJson(url, user.token, "/api/wallet/ledger");
      expect((first.body as unknown[]).length).toBe(100); // default limit unchanged

      const third = await getJson(url, user.token, "/api/wallet/ledger?page=3");
      const rows = third.body as unknown[];
      expect(rows.length).toBe(5); // rows 201..205

      // page=2 × limit=200: the alternative walk to the same tail.
      const second = await getJson(url, user.token, "/api/wallet/ledger?page=2&limit=200");
      expect((second.body as unknown[]).length).toBe(5);

      const explicit = await getJson(url, user.token, "/api/wallet/ledger?page=1");
      expect(explicit.body).toStrictEqual(first.body);
    } finally {
      close();
    }
  });
});

// ── GET /api/loyalty/ledger ─────────────────────────────────────────────────
describe("A6-F1 — GET /api/loyalty/ledger pagination", () => {
  const TOTAL = 205;

  it("page=3 (default limit 100) reaches rows 201+; page=1 default identical", async () => {
    const user = await seedUser();
    await db.insert(pointsLedgerTable).values(
      Array.from({ length: TOTAL }, (_, i) => ({
        userId: user.id,
        type: "purchase_award" as const,
        pointsDelta: 1,
        pointsBefore: i,
        pointsAfter: i + 1,
        createdAt: createdAtFor(i, TOTAL),
      })),
    );
    const { url, close } = await listen(buildApp([["/api/loyalty", loyaltyRouter]]));
    try {
      const first = await getJson(url, user.token, "/api/loyalty/ledger");
      expect((first.body as unknown[]).length).toBe(100);

      const third = await getJson(url, user.token, "/api/loyalty/ledger?page=3");
      expect((third.body as unknown[]).length).toBe(5);

      const second = await getJson(url, user.token, "/api/loyalty/ledger?page=2&limit=200");
      expect((second.body as unknown[]).length).toBe(5); // rows 201..205

      const explicit = await getJson(url, user.token, "/api/loyalty/ledger?page=1");
      expect(explicit.body).toStrictEqual(first.body);
    } finally {
      close();
    }
  });
});
