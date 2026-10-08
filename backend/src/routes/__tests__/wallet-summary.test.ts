import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import { eq } from "drizzle-orm";
import { db, initTestDb, resetTestDb, usersTable, walletTopupsTable } from "../../test/db";
import { signUserToken } from "../../lib/jwt";
import { walletRouter } from "../wallet";

/**
 * R123 (E1, test battery) — GET /api/wallet (the money summary).
 *
 * The wallet screen's primary read had no dedicated suite: its numbers
 * (balance / loyalty_points / loyalty_tier / pending_topups_count) were
 * only ever asserted incidentally through other flows. Pinned here:
 *
 *   1. the four money fields reflect the user row + the user-scoped
 *      pending count, with 0 vs 2 pending explicitly distinguished
 *      (approved/rejected rows must NOT count);
 *   2. the 401 ACCOUNT_NOT_FOUND branch — a valid session whose user
 *      row is gone (AUD103-4-F2: one failure class, one shape — wallet
 *      used to answer UNAUTHORIZED here);
 *   3. the A7/round-94 no-store header on this per-user money surface.
 *
 * Mount-and-fetch idiom from wallet-topups.test.ts.
 */

function buildApp(): Express {
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
        reject(new Error("listener address is not AddressInfo"));
        return;
      }
      resolve({ url: `http://127.0.0.1:${addr.port}`, close: () => server.close() });
    });
  });
}

let phoneSeq = 92_100_000;
function nextPhone(): string {
  phoneSeq += 1;
  return String(phoneSeq);
}

async function seedUser(overrides: Partial<typeof usersTable.$inferInsert> = {}) {
  const [u] = await db
    .insert(usersTable)
    .values({ phone: nextPhone(), ...overrides })
    .returning();
  return u;
}

type TopupStatus = "pending" | "approved" | "rejected";

async function seedTopup(userId: number, status: TopupStatus) {
  await db.insert(walletTopupsTable).values({
    userId,
    amount: "20.00",
    paymentMethod: "mobile_transfer",
    paymentNetwork: "madar",
    status,
  });
}

async function getWallet(url: string, token: string) {
  const res = await fetch(`${url}/api/wallet`, {
    headers: { Cookie: `auth_token=${token}` },
  });
  const text = await res.text();
  return {
    status: res.status,
    cacheControl: res.headers.get("cache-control"),
    body: text ? (JSON.parse(text) as Record<string, unknown>) : null,
  };
}

const app = buildApp();

beforeAll(async () => {
  await initTestDb();
});
beforeEach(async () => {
  await resetTestDb();
});

describe("GET /api/wallet — the money summary", () => {
  it("returns balance, loyalty_points, loyalty_tier and pending_topups_count from the user row (0 pending)", async () => {
    const user = await seedUser({
      walletBalance: "123.45",
      loyaltyPoints: 250,
      loyaltyTier: "silver",
    });
    const token = signUserToken({ userId: user.id });
    const { url, close } = await listen(app);
    try {
      const res = await getWallet(url, token);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        balance: 123.45,
        loyalty_points: 250,
        loyalty_tier: "silver",
        pending_topups_count: 0,
        recent_orders: [],
      });
    } finally {
      close();
    }
  });

  it("counts ONLY this user's pending topups — 2 pending, with approved/rejected excluded", async () => {
    const user = await seedUser({ walletBalance: "10.00", loyaltyPoints: 0 });
    // A second user's pending row must not leak into this user's count.
    const other = await seedUser();
    await seedTopup(user.id, "pending");
    await seedTopup(user.id, "pending");
    await seedTopup(user.id, "approved");
    await seedTopup(user.id, "rejected");
    await seedTopup(other.id, "pending");

    const token = signUserToken({ userId: user.id });
    const { url, close } = await listen(app);
    try {
      const res = await getWallet(url, token);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        balance: 10,
        pending_topups_count: 2, // 0 vs 2 distinguished; only pending counts
      });
    } finally {
      close();
    }
  });

  it("answers 401 ACCOUNT_NOT_FOUND when the session's user row is gone (not UNAUTHORIZED)", async () => {
    const user = await seedUser({ walletBalance: "5.00" });
    const token = signUserToken({ userId: user.id });
    // The user row disappears (e.g. manual cleanup) while the token is
    // still cryptographically valid — requireUser passes (sid-less
    // legacy token, non-production), and the summary must use the ONE
    // failure shape: 401 ACCOUNT_NOT_FOUND (AUD103-4-F2).
    await db.delete(usersTable).where(eq(usersTable.id, user.id));

    const { url, close } = await listen(app);
    try {
      const res = await getWallet(url, token);
      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({ code: "ACCOUNT_NOT_FOUND" });
    } finally {
      close();
    }
  });

  it("ships Cache-Control: no-store (A7/round-94 — per-user money state)", async () => {
    const user = await seedUser();
    const token = signUserToken({ userId: user.id });
    const { url, close } = await listen(app);
    try {
      const res = await getWallet(url, token);
      expect(res.status).toBe(200);
      expect(res.cacheControl).toBe("no-store");
    } finally {
      close();
    }
  });
});
