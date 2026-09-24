import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { count, eq } from "drizzle-orm";
import { db, initTestDb, resetTestDb, usersTable, walletTopupsTable } from "../../test/db";
import { signUserToken } from "../../lib/jwt";
import { getRedisClient } from "../../lib/redis-client";
import { walletRouter } from "../wallet";

/**
 * 96-F1 (R96-A5 M2) — POST /api/wallet/topups now mounts the idempotency
 * middleware (`routeKey: wallet.topups.create`) after requireUser, the
 * exact orders.ts pattern.
 *
 * Before the fix this was the last unprotected money path: a slow network
 * + impatient double-tap created TWO identical pending topups (the
 * approval-time reference dedup only helps when the optional
 * payment_reference was entered — both halves of the fix are needed:
 * this backend middleware here, the Idempotency-Key header from the
 * frontend wallet form in F6).
 *
 * The Redis singleton is mocked with an in-memory capture client so the
 * middleware's real replay branch is exercised end-to-end through the
 * mounted route (no-Redis tests would only prove the pass-through).
 */

vi.mock("../../lib/redis-client", () => ({
  getRedisClient: vi.fn(),
  withRedisCommandTimeout: <T>(_label: string, fn: () => Promise<T>) => fn(),
}));

const getRedisClientMock = vi.mocked(getRedisClient);

/** In-memory Redis stand-in covering the middleware's get/set/del usage. */
function installMemoryRedis(): Map<string, string> {
  const store = new Map<string, string>();
  getRedisClientMock.mockReturnValue({
    get: async (key: string) => store.get(key) ?? null,
    set: async (key: string, value: string, opts: { NX?: boolean } = {}) => {
      if (opts?.NX && store.has(key)) return null;
      store.set(key, value);
      return "OK";
    },
    del: async (...keys: string[]) => {
      for (const key of keys) store.delete(key);
      return keys.length;
    },
  } as unknown as ReturnType<typeof getRedisClient>);
  return store;
}

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

let phoneSeq = 91_960_000;
async function seedUser(): Promise<{ id: number; token: string }> {
  phoneSeq += 1;
  const [u] = await db
    .insert(usersTable)
    .values({ phone: String(phoneSeq), walletBalance: "0.00" })
    .returning();
  return { id: u.id, token: signUserToken({ userId: u.id }) };
}

let topupRefSeq = 0;
function topupBody() {
  // B4-R1 (R111): mobile_transfer now REQUIRES a payment_reference, and
  // the route dedups same user+ref+amount PENDING resubmissions. Each
  // call mints a FRESH receipt so every test post here is a distinct
  // transfer intent — the same-receipt dedup is pinned in
  // wallet-topups.test.ts (B4-R1 describe block).
  topupRefSeq += 1;
  return {
    amount: 50,
    payment_method: "mobile_transfer",
    payment_network: "madar",
    sender_phone: "0913456789",
    payment_reference: `TRX-IDEM-${topupRefSeq}`,
  };
}

async function postTopup(
  url: string,
  token: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; headers: Headers; body: unknown }> {
  const res = await fetch(`${url}/api/wallet/topups`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `auth_token=${token}`,
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
}

async function pendingRowCount(userId: number): Promise<number> {
  const [row] = await db
    .select({ c: count() })
    .from(walletTopupsTable)
    .where(eq(walletTopupsTable.userId, userId));
  return Number(row?.c ?? 0);
}

beforeAll(async () => {
  await initTestDb();
});

beforeEach(async () => {
  await resetTestDb();
  installMemoryRedis();
  vi.resetModules();
});

describe("POST /api/wallet/topups — idempotency middleware mounted (96-F1 M2)", () => {
  it("retries with the SAME Idempotency-Key replay the original 201 — exactly one pending row", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const { id: userId, token } = await seedUser();
      const key = { "Idempotency-Key": "topup idem key 0001" };

      // R111 fix (B4-R1 test fallout): build the body ONCE. topupBody()
      // mints a unique payment_reference per call (the duplicate-receipt
      // guard needs distinct receipts across INTENTS), but a same-key
      // retry must carry the IDENTICAL body — the middleware's replay
      // hash check (correctly) rejects a reused key with a changed body
      // as IDEMPOTENCY_KEY_REUSE. Two fresh topupBody() calls here used
      // to silently differ (only by the receipt) and 409'd the retry.
      const body = topupBody();
      const first = await postTopup(url, token, body, key);
      expect(first.status).toBe(201);
      const firstId = (first.body as { id: number }).id;

      // Network-level retry: same key, same body → replay, not a second row.
      const retry = await postTopup(url, token, body, key);
      expect(retry.status).toBe(201);
      expect(retry.headers.get("Idempotent-Replayed")).toBe("true");
      expect((retry.body as { id: number }).id).toBe(firstId);

      expect(await pendingRowCount(userId)).toBe(1);
    } finally {
      close();
    }
  });

  it("a DIFFERENT Idempotency-Key is a distinct intent — second row created", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const { id: userId, token } = await seedUser();

      const first = await postTopup(url, token, topupBody(), {
        "Idempotency-Key": "topup idem key 0002",
      });
      expect(first.status).toBe(201);
      // B4-R1: a distinct key AND a distinct receipt (topupBody() mints a
      // fresh reference per call) — two genuinely separate transfers.
      const second = await postTopup(url, token, topupBody(), {
        "Idempotency-Key": "topup idem key 0003",
      });
      expect(second.status).toBe(201);
      expect((second.body as { id: number }).id).not.toBe((first.body as { id: number }).id);

      expect(await pendingRowCount(userId)).toBe(2);
    } finally {
      close();
    }
  });

  it("same key with a DIFFERENT body → 409 IDEMPOTENCY_KEY_REUSE (client bug surfaced)", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const { token } = await seedUser();
      const key = { "Idempotency-Key": "topup idem key 0004" };

      const first = await postTopup(url, token, topupBody(), key);
      expect(first.status).toBe(201);

      const mutated = { ...topupBody(), amount: 100 };
      const conflict = await postTopup(url, token, mutated, key);
      expect(conflict.status).toBe(409);
      expect(conflict.body).toMatchObject({ code: "IDEMPOTENCY_KEY_REUSE" });
    } finally {
      close();
    }
  });

  it("requests WITHOUT a key still pass through (legacy clients keep working for distinct receipts)", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const { id: userId, token } = await seedUser();

      const first = await postTopup(url, token, topupBody());
      expect(first.status).toBe(201);
      const second = await postTopup(url, token, topupBody());
      expect(second.status).toBe(201);
      expect(second.headers.get("Idempotent-Replayed")).toBeNull();

      // Legacy shape: no key → no KEY-layer dedup. (The B4-R1 receipt
      // dedup DOES engage for the same receipt without a key — pinned in
      // wallet-topups.test.ts — but these two posts carry distinct
      // receipts, i.e. two real transfers.)
      expect(await pendingRowCount(userId)).toBe(2);
    } finally {
      close();
    }
  });

  it("a 4xx validation failure does not lock the key — corrected retry runs live", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const { id: userId, token } = await seedUser();
      const key = { "Idempotency-Key": "topup idem key 0005" };

      // Invalid body (missing payment_network for mobile_transfer) → 400.
      const bad = await postTopup(
        url,
        token,
        { amount: 50, payment_method: "mobile_transfer" },
        key,
      );
      expect(bad.status).toBe(400);

      // Corrected retry with the SAME key must run live, not replay the 400.
      const good = await postTopup(url, token, topupBody(), key);
      expect(good.status).toBe(201);
      expect(good.headers.get("Idempotent-Replayed")).toBeNull();
      expect(await pendingRowCount(userId)).toBe(1);
    } finally {
      close();
    }
  });
});
