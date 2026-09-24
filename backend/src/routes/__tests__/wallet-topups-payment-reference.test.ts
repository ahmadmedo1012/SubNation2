/**
 * F-03 (round-93 A2) — POST /api/wallet/topups payment_reference
 * normalization at the route boundary.
 *
 * The wallet form (wallet.tsx — C5 agent) sends the transfer receipt
 * id as `payment_reference`. The route normalizes it BEFORE persisting so
 * every downstream dedup layer (V1-M9 partial unique index, B2-02 in-tx
 * exact check, advisory lock, composite soft-dedup) compares canonical
 * values — a raw "  TRX-9  " would dodge the exact-match guards while
 * still being the same transfer.
 *
 * B4-R1 (R111): the reference is now REQUIRED for mobile_transfer (a
 * blank ref was exempt from every dedup layer → the dual-approval
 * window); blank-after-trim therefore 400s on that method instead of
 * storing NULL. lypay keeps it optional.
 *
 * The 100-char handler cap is pinned in wallet-topups.test.ts (validation
 * block); this file pins the persistence normalization.
 */

import express from "express";
import cookieParser from "cookie-parser";
import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db, initTestDb, resetTestDb, usersTable, walletTopupsTable } from "../../test/db";
import { signUserToken } from "../../lib/jwt";
import { walletRouter } from "../wallet";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/wallet", walletRouter);
  return app;
}

const app = buildApp();

beforeAll(async () => {
  await initTestDb();
});
beforeEach(async () => {
  await resetTestDb();
});

let phoneSeq = 91_950_000;
function nextPhone(): string {
  phoneSeq += 1;
  return String(phoneSeq);
}

async function seedUser() {
  const [u] = await db
    .insert(usersTable)
    .values({ phone: nextPhone(), walletBalance: "0.00" })
    .returning();
  return u;
}

async function postTopup(token: string, body: Record<string, unknown>) {
  const server = app.listen(0);
  try {
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no address");
    const res = await fetch(`http://127.0.0.1:${addr.port}/api/wallet/topups`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: `auth_token=${token}` },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    return {
      status: res.status,
      body: text ? (JSON.parse(text) as Record<string, unknown>) : null,
    };
  } finally {
    server.close();
  }
}

describe("F-03: payment_reference normalization on POST /api/wallet/topups", () => {
  it("trims surrounding whitespace before persisting (canonical dedup key)", async () => {
    const user = await seedUser();
    const token = signUserToken({ userId: user.id });

    const res = await postTopup(token, {
      amount: 50,
      payment_network: "madar",
      sender_phone: "0912345678",
      payment_reference: "   TRX-TRIM-9   ",
    });
    expect(res.status).toBe(201);
    expect(res.body!.payment_reference).toBe("TRX-TRIM-9");

    const [row] = await db
      .select()
      .from(walletTopupsTable)
      .where(eq(walletTopupsTable.id, res.body!.id as number));
    expect(row.paymentReference).toBe("TRX-TRIM-9");
  });

  it("whitespace-only reference on mobile_transfer now 400s (B4-R1 — blank refs were the dual-approval class)", async () => {
    const user = await seedUser();
    const token = signUserToken({ userId: user.id });

    const res = await postTopup(token, {
      amount: 50,
      payment_network: "madar",
      payment_reference: "   ",
    });
    expect(res.status).toBe(400);
    expect(res.body!.code).toBe("INVALID_DATA");
  });

  it("omitting the field entirely on mobile_transfer 400s (B4-R1 — legacy ref-less shape is closed at creation)", async () => {
    const user = await seedUser();
    const token = signUserToken({ userId: user.id });

    const res = await postTopup(token, { amount: 50, payment_network: "madar" });
    expect(res.status).toBe(400);
    expect(res.body!.code).toBe("INVALID_DATA");
  });

  it("a NULL reference still round-trips for lypay (optional there) — the DB column stays nullable", async () => {
    const user = await seedUser();
    const token = signUserToken({ userId: user.id });

    const res = await postTopup(token, {
      amount: 25,
      payment_method: "lypay",
      sender_account: "LYP-NULLREF-1",
    });
    expect(res.status).toBe(201);
    expect(res.body!.payment_reference).toBeNull();
  });
});
