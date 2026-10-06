import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import { eq } from "drizzle-orm";
import { db, initTestDb, notificationsTable, resetTestDb, usersTable } from "../../test/db";
import { signUserToken } from "../../lib/jwt";
import { notificationsRouter } from "../notifications";

/**
 * R118-A5 TOP-20 #15 [P3] — routes/notifications.ts (GET /, POST
 * /read-all, POST /:id/read) had ZERO route tests.
 *
 * Pinned contracts:
 *   - 401 without a token;
 *   - ownership: a foreign notification id → honest 404 (never a silent
 *     {success:true}); the caller's own row marks read;
 *   - read-all marks EVERY own row read and answers {success:true}
 *     (NOTE: the route does NOT return a count — deviation from the A5
 *     sketch, pinned as-coded);
 *   - list shape: user-scoped, newest-first, capped at 40, DTO keys
 *     {id, type, title, message, link, is_read, created_at}, with
 *     Cache-Control: no-store (A7 round-94).
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
    .values({ phone: `94601${String(phoneSeq).padStart(5, "0")}` })
    .returning();
  return { id: u.id, token: signUserToken({ userId: u.id }) };
}

async function seedNotification(
  userId: number,
  n: number,
  read = false,
): Promise<number> {
  const [row] = await db
    .insert(notificationsTable)
    .values({
      userId,
      type: "order",
      title: `إشعار ${n}`,
      message: `رسالة ${n}`,
      link: `/orders`,
      isRead: read,
    })
    .returning();
  return row.id;
}

beforeAll(async () => {
  await initTestDb();
});
beforeEach(async () => {
  await resetTestDb();
});

describe("GET /api/notifications (R118-A5 #15)", () => {
  it("401 without a token", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const res = await fetch(`${url}/api/notifications`);
      expect(res.status).toBe(401);
    } finally {
      close();
    }
  });

  it("lists the caller's notifications only, newest-first, with the DTO shape + no-store", async () => {
    const user = await seedUser();
    await seedNotification(user.id, 1);
    await seedNotification(user.id, 2);
    // Another user's rows must never leak into the list.
    const stranger = await seedUser();
    await seedNotification(stranger.id, 99);

    const { url, close } = await listen(buildApp());
    try {
      const res = await fetch(`${url}/api/notifications`, {
        headers: { Cookie: `auth_token=${user.token}` },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");

      const list = (await res.json()) as Array<Record<string, unknown>>;
      expect(list).toHaveLength(2);
      // Newest-first (desc by created_at — seeded sequentially).
      expect(list[0].title).toBe("إشعار 2");
      expect(list[1].title).toBe("إشعار 1");
      // DTO contract.
      expect(list[0]).toMatchObject({
        type: "order",
        title: "إشعار 2",
        message: "رسالة 2",
        link: "/orders",
        is_read: false,
        created_at: expect.any(String),
      });
      expect(Object.keys(list[0]).sort()).toEqual(
        ["created_at", "id", "is_read", "link", "message", "title", "type"].sort(),
      );
    } finally {
      close();
    }
  });

  it("the list is capped at 40 rows (pagination shape)", async () => {
    const user = await seedUser();
    for (let i = 0; i < 45; i++) {
      await seedNotification(user.id, i + 1);
    }

    const { url, close } = await listen(buildApp());
    try {
      const res = await fetch(`${url}/api/notifications`, {
        headers: { Cookie: `auth_token=${user.token}` },
      });
      const list = (await res.json()) as Array<Record<string, unknown>>;
      expect(list).toHaveLength(40);
      // The 40 NEWEST — the oldest 5 fall off the page.
      expect(list[0].title).toBe("إشعار 45");
      expect(list[39].title).toBe("إشعار 6");
    } finally {
      close();
    }
  });
});

describe("POST /api/notifications/read-all (R118-A5 #15)", () => {
  it("marks every OWN row read, leaves the stranger's rows untouched, answers success (no count — as-coded)", async () => {
    const user = await seedUser();
    await seedNotification(user.id, 1);
    await seedNotification(user.id, 2, true); // already read
    await seedNotification(user.id, 3);
    const stranger = await seedUser();
    const strangerUnread = await seedNotification(stranger.id, 99);

    const { url, close } = await listen(buildApp());
    try {
      const res = await fetch(`${url}/api/notifications/read-all`, {
        method: "POST",
        headers: { Cookie: `auth_token=${user.token}` },
      });
      expect(res.status).toBe(200);
      // As-coded: {success:true} only — the route returns no count.
      expect(await res.json()).toEqual({ success: true });

      const mine = await db
        .select()
        .from(notificationsTable)
        .where(eq(notificationsTable.userId, user.id));
      expect(mine).toHaveLength(3);
      expect(mine.every((r) => r.isRead)).toBe(true);

      const theirs = await db
        .select()
        .from(notificationsTable)
        .where(eq(notificationsTable.id, strangerUnread));
      expect(theirs[0].isRead).toBe(false);
    } finally {
      close();
    }
  });
});

describe("POST /api/notifications/:id/read (R118-A5 #15)", () => {
  it("marks the caller's OWN notification read", async () => {
    const user = await seedUser();
    const id = await seedNotification(user.id, 1);

    const { url, close } = await listen(buildApp());
    try {
      const res = await fetch(`${url}/api/notifications/${id}/read`, {
        method: "POST",
        headers: { Cookie: `auth_token=${user.token}` },
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true });
      const [row] = await db
        .select()
        .from(notificationsTable)
        .where(eq(notificationsTable.id, id));
      expect(row.isRead).toBe(true);
    } finally {
      close();
    }
  });

  it("a FOREIGN notification id → honest 404 (ownership — never a silent success)", async () => {
    const user = await seedUser();
    const stranger = await seedUser();
    const strangerId = await seedNotification(stranger.id, 1);

    const { url, close } = await listen(buildApp());
    try {
      const res = await fetch(`${url}/api/notifications/${strangerId}/read`, {
        method: "POST",
        headers: { Cookie: `auth_token=${user.token}` },
      });
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ code: "NOT_FOUND" });
      // The stranger's row is NOT marked read by the probe.
      const [row] = await db
        .select()
        .from(notificationsTable)
        .where(eq(notificationsTable.id, strangerId));
      expect(row.isRead).toBe(false);
    } finally {
      close();
    }
  });

  it("an invalid id (non-integer) → 400", async () => {
    const user = await seedUser();
    const { url, close } = await listen(buildApp());
    try {
      const res = await fetch(`${url}/api/notifications/not-an-int/read`, {
        method: "POST",
        headers: { Cookie: `auth_token=${user.token}` },
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: "INVALID_DATA" });
    } finally {
      close();
    }
  });
});
