import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import { and, eq } from "drizzle-orm";
import { db, initTestDb, pushTokensTable, resetTestDb, usersTable } from "../../test/db";
import { signUserToken } from "../../lib/jwt";
import { notificationsRouter } from "../notifications";
import { sendPushToUser } from "../../services/push.service";

/**
 * R191 (backend mobile contracts) — the Expo push-token surface:
 *
 * Routes (mounted at /api/notifications, requireUser):
 *   POST   /push-tokens — register (new + UPSERT ownership transfer + 400s)
 *   DELETE /push-tokens — soft-revoke (owner 200 / foreign 404)
 *   GET    /push-tokens — the caller's ACTIVE registrations (DTO shape)
 *
 * Service (services/push.service.ts) — best-effort semantics with the
 * Expo endpoint mocked at the fetch boundary (no network in tests):
 *   - no active tokens → zero fetches;
 *   - delivery batches one message per token to exp.host;
 *   - DeviceNotRegistered in the 200 body soft-revokes (purges) the token;
 *   - a transport failure NEVER throws (the caller's request continues).
 */

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/notifications", notificationsRouter);
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

let phoneSeq = 0;
async function seedUser(): Promise<{ id: number; token: string }> {
  phoneSeq += 1;
  const [u] = await db
    .insert(usersTable)
    .values({ phone: `94602${String(phoneSeq).padStart(5, "0")}` })
    .returning();
  return { id: u.id, token: signUserToken({ userId: u.id }) };
}

const TOKEN_A = "ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa]";
const TOKEN_B = "ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb]";

beforeAll(async () => {
  await initTestDb();
});

beforeEach(async () => {
  await resetTestDb();
});

// ── Routes ──────────────────────────────────────────────────────────────────

describe("POST /api/notifications/push-tokens (R191)", () => {
  it("401 without a token", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const res = await fetch(`${url}/api/notifications/push-tokens`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: url },
        body: JSON.stringify({ expo_push_token: TOKEN_A, platform: "android" }),
      });
      expect(res.status).toBe(401);
    } finally {
      close();
    }
  });

  it("registers a new token (200, row created, 200-shape success body)", async () => {
    const user = await seedUser();
    const { url, close } = await listen(buildApp());
    try {
      const res = await fetch(`${url}/api/notifications/push-tokens`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `auth_token=${user.token}`,
          Origin: url,
        },
        body: JSON.stringify({
          expo_push_token: TOKEN_A,
          platform: "android",
          device_label: "هاتف أحمد",
        }),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true });

      const rows = await db.select().from(pushTokensTable);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        userId: user.id,
        expoPushToken: TOKEN_A,
        platform: "android",
        deviceLabel: "هاتف أحمد",
        revokedAt: null,
      });
      // UUID pk + timestamps came from the DB defaults.
      expect(rows[0].id).toMatch(/^[0-9a-f-]{36}$/);
      expect(rows[0].createdAt instanceof Date).toBe(true);
    } finally {
      close();
    }
  });

  it("re-registration UPSERTS: ownership transfers to the new user, one row survives, revoked un-revokes", async () => {
    const first = await seedUser();
    const second = await seedUser();

    const { url, close } = await listen(buildApp());
    try {
      const register = (token: string, body: unknown) =>
        fetch(`${url}/api/notifications/push-tokens`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: `auth_token=${token}`,
            Origin: url,
          },
          body: JSON.stringify(body),
        });

      await register(first.token, { expo_push_token: TOKEN_A, platform: "ios" });
      // Logout-style revoke, then the SAME device re-registers under the
      // second account: ownership transfers + the revoke is lifted.
      await fetch(`${url}/api/notifications/push-tokens`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Cookie: `auth_token=${first.token}`,
          Origin: url,
        },
        body: JSON.stringify({ expo_push_token: TOKEN_A }),
      });
      const res = await register(second.token, {
        expo_push_token: TOKEN_A,
        platform: "ios",
        device_label: "نفس الجهاز",
      });
      expect(res.status).toBe(200);

      const rows = await db.select().from(pushTokensTable);
      expect(rows).toHaveLength(1); // upsert, never a second row
      expect(rows[0]).toMatchObject({
        userId: second.id, // ownership transferred
        revokedAt: null, // un-revoked by re-registration
        deviceLabel: "نفس الجهاز",
      });
    } finally {
      close();
    }
  });

  it("an invalid token shape → 400 (no row written)", async () => {
    const user = await seedUser();
    const { url, close } = await listen(buildApp());
    try {
      for (const bad of [
        { expo_push_token: "not-an-expo-token", platform: "android" }, // wrong prefix
        { expo_push_token: "ExponentPushToken[" + "x".repeat(300), platform: "android" }, // >255
        { expo_push_token: TOKEN_A, platform: "webos" }, // bad platform enum
      ]) {
        const res = await fetch(`${url}/api/notifications/push-tokens`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: `auth_token=${user.token}`,
            Origin: url,
          },
          body: JSON.stringify(bad),
        });
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ code: "INVALID_DATA" });
      }
      expect(await db.select().from(pushTokensTable)).toHaveLength(0);
    } finally {
      close();
    }
  });
});

describe("DELETE /api/notifications/push-tokens (R191)", () => {
  it("the owner soft-revokes: 200, revoked_at set, row SURVIVES for audit", async () => {
    const user = await seedUser();
    await db.insert(pushTokensTable).values({
      userId: user.id,
      expoPushToken: TOKEN_A,
      platform: "android",
    });

    const { url, close } = await listen(buildApp());
    try {
      const res = await fetch(`${url}/api/notifications/push-tokens`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Cookie: `auth_token=${user.token}`,
          Origin: url,
        },
        body: JSON.stringify({ expo_push_token: TOKEN_A }),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true });

      const rows = await db.select().from(pushTokensTable);
      expect(rows).toHaveLength(1); // soft revoke — audit history stays
      expect(rows[0].revokedAt).toBeInstanceOf(Date);
    } finally {
      close();
    }
  });

  it("a FOREIGN token (owned by another user) → honest 404, row untouched", async () => {
    const owner = await seedUser();
    const stranger = await seedUser();
    await db.insert(pushTokensTable).values({
      userId: owner.id,
      expoPushToken: TOKEN_A,
      platform: "ios",
    });

    const { url, close } = await listen(buildApp());
    try {
      const res = await fetch(`${url}/api/notifications/push-tokens`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Cookie: `auth_token=${stranger.token}`,
          Origin: url,
        },
        body: JSON.stringify({ expo_push_token: TOKEN_A }),
      });
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ code: "NOT_FOUND" });
      const [row] = await db.select().from(pushTokensTable);
      expect(row.revokedAt).toBeNull();
    } finally {
      close();
    }
  });

  it("an unknown token → 404", async () => {
    const user = await seedUser();
    const { url, close } = await listen(buildApp());
    try {
      const res = await fetch(`${url}/api/notifications/push-tokens`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Cookie: `auth_token=${user.token}`,
          Origin: url,
        },
        body: JSON.stringify({ expo_push_token: TOKEN_B }),
      });
      expect(res.status).toBe(404);
    } finally {
      close();
    }
  });
});

describe("GET /api/notifications/push-tokens (R191)", () => {
  it("lists ONLY the caller's ACTIVE registrations, newest last-seen first, DTO shape + no-store", async () => {
    const user = await seedUser();
    const stranger = await seedUser();
    await db.insert(pushTokensTable).values([
      {
        userId: user.id,
        expoPushToken: TOKEN_A,
        platform: "android",
        deviceLabel: "جهاز أول",
        lastSeenAt: new Date("2026-10-01T10:00:00Z"),
      },
      {
        userId: user.id,
        expoPushToken: TOKEN_B,
        platform: "ios",
        lastSeenAt: new Date("2026-10-02T10:00:00Z"),
      },
      // A revoked row of the caller — audit history, not a device list.
      {
        userId: user.id,
        expoPushToken: "ExponentPushToken[cccccccccccccccccccccccccccccccccc]",
        platform: "android",
        revokedAt: new Date("2026-09-30T10:00:00Z"),
      },
      // A stranger's row — never leaks.
      {
        userId: stranger.id,
        expoPushToken: "ExponentPushToken[dddddddddddddddddddddddddddddddddd]",
        platform: "ios",
      },
    ]);

    const { url, close } = await listen(buildApp());
    try {
      const res = await fetch(`${url}/api/notifications/push-tokens`, {
        headers: { Cookie: `auth_token=${user.token}` },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");

      const body = (await res.json()) as { push_tokens: Array<Record<string, unknown>> };
      expect(body.push_tokens).toHaveLength(2);
      // Newest last-seen first.
      expect(body.push_tokens[0]).toMatchObject({
        platform: "ios",
        device_label: null,
        last_seen_at: expect.any(String),
      });
      expect(Object.keys(body.push_tokens[0]).sort()).toEqual(
        ["device_label", "id", "last_seen_at", "platform"].sort(),
      );
      // The token VALUE is never part of the list DTO.
      expect(JSON.stringify(body)).not.toContain(TOKEN_B);
    } finally {
      close();
    }
  });
});

// ── Service (best-effort semantics, mocked fetch) ───────────────────────────

// NOTE: the fetch replacement is scoped INSIDE the service describe below —
// a file-level beforeAll would swap fetch for the route tests too (their
// real HTTP calls would hit the unconfigured mock and resolve undefined).

const ORIGINAL_FETCH = globalThis.fetch;
const fetchMock = vi.fn();

describe("sendPushToUser (R191 — best-effort by design)", () => {
  beforeAll(() => {
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterAll(() => {
    globalThis.fetch = ORIGINAL_FETCH;
  });

  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("no active tokens → zero fetches, zero Expo calls", async () => {
    const user = await seedUser();
    const calls = await sendPushToUser(user.id, { title: "عنوان", body: "نص" });
    expect(calls).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("revoked tokens are skipped (only ACTIVE rows are read)", async () => {
    const user = await seedUser();
    await db.insert(pushTokensTable).values({
      userId: user.id,
      expoPushToken: TOKEN_A,
      platform: "android",
      revokedAt: new Date(),
    });
    const calls = await sendPushToUser(user.id, { title: "عنوان", body: "نص" });
    expect(calls).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("delivers one message per active token to the Expo endpoint, never throws", async () => {
    const user = await seedUser();
    await db.insert(pushTokensTable).values([
      { userId: user.id, expoPushToken: TOKEN_A, platform: "android" },
      { userId: user.id, expoPushToken: TOKEN_B, platform: "ios" },
    ]);
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ status: "ok" }, { status: "ok" }] }), {
        status: 200,
      }),
    );

    const calls = await sendPushToUser(user.id, {
      title: "تم اعتماد طلب الشحن",
      body: "تمت إضافة الرصيد إلى محفظتك بنجاح",
      data: { link: "/wallet" },
    });
    expect(calls).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [input, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(input).toBe("https://exp.host/--/api/v2/push/sendMessage");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    const payload = JSON.parse(String(init.body)) as {
      messages: Array<{ to: string; title: string; body: string; data?: Record<string, string> }>;
    };
    expect(payload.messages).toHaveLength(2);
    expect(new Set(payload.messages.map((m) => m.to))).toEqual(new Set([TOKEN_A, TOKEN_B]));
    expect(payload.messages[0]).toMatchObject({
      title: "تم اعتماد طلب الشحن",
      body: "تمت إضافة الرصيد إلى محفظتك بنجاح",
      data: { link: "/wallet" },
    });
    // Both tokens stay live (no error statuses in the body).
    const live = await db.select().from(pushTokensTable).where(eq(pushTokensTable.userId, user.id));
    expect(live.every((r) => r.revokedAt === null)).toBe(true);
  });

  it("DeviceNotRegistered in the 200 body PURGES the token (soft revoke)", async () => {
    const user = await seedUser();
    await db.insert(pushTokensTable).values({
      userId: user.id,
      expoPushToken: TOKEN_A,
      platform: "android",
    });
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ data: [{ status: "error", details: { error: "DeviceNotRegistered" } }] }),
        { status: 200 },
      ),
    );

    const calls = await sendPushToUser(user.id, { title: "عنوان", body: "نص" });
    expect(calls).toBe(1);
    const [row] = await db
      .select()
      .from(pushTokensTable)
      .where(eq(pushTokensTable.expoPushToken, TOKEN_A));
    expect(row.revokedAt).toBeInstanceOf(Date);
  });

  it("a transport failure NEVER throws (the caller's request continues)", async () => {
    const user = await seedUser();
    await db.insert(pushTokensTable).values({
      userId: user.id,
      expoPushToken: TOKEN_A,
      platform: "android",
    });
    fetchMock.mockRejectedValueOnce(new Error("network down"));

    await expect(sendPushToUser(user.id, { title: "عنوان", body: "نص" })).resolves.toBe(0);
    // The token row is untouched — a network failure is not a token verdict.
    const [row] = await db
      .select()
      .from(pushTokensTable)
      .where(and(eq(pushTokensTable.userId, user.id)));
    expect(row.revokedAt).toBeNull();
  });

  it("a non-2xx Expo response is swallowed (no retries, tokens untouched)", async () => {
    const user = await seedUser();
    await db.insert(pushTokensTable).values({
      userId: user.id,
      expoPushToken: TOKEN_A,
      platform: "android",
    });
    fetchMock.mockResolvedValueOnce(new Response("[]", { status: 503 }));

    await expect(sendPushToUser(user.id, { title: "عنوان", body: "نص" })).resolves.toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1); // NO retry
    const [row] = await db.select().from(pushTokensTable);
    expect(row.revokedAt).toBeNull();
  });
});
