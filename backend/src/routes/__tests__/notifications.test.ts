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
 *
 * A9-F2 (R128-IMP-5): the additive ?page= envelope — the audit-logs
 * route's pagination idiom (R127-L5) pinned by its own suite's shapes:
 * clamps, hasMore honesty, the id-DESC tiebreaker, and the OPT-IN
 * contract that keeps the paramless response a plain array for the
 * bell (which guards Array.isArray).
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
  createdAt?: Date,
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
      ...(createdAt ? { createdAt } : {}),
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

describe("GET /api/notifications?page= — the A9-F2 paged envelope (R128-IMP-5)", () => {
  it("401 without a token (the paged shape rides the same gate)", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const res = await fetch(`${url}/api/notifications?page=1`);
      expect(res.status).toBe(401);
    } finally {
      close();
    }
  });

  it("?page= is OPT-IN: the paramless body stays a plain array, the paged body is the audit-logs envelope", async () => {
    const user = await seedUser();
    await seedNotification(user.id, 1);
    await seedNotification(user.id, 2);

    const { url, close } = await listen(buildApp());
    try {
      const paramless = await fetch(`${url}/api/notifications`, {
        headers: { Cookie: `auth_token=${user.token}` },
      });
      const bare = await paramless.json();
      // The bell's byte-compatible contract: a bare ARRAY.
      expect(Array.isArray(bare)).toBe(true);
      expect(bare).toHaveLength(2);

      const paged = await fetch(`${url}/api/notifications?page=1`, {
        headers: { Cookie: `auth_token=${user.token}` },
      });
      const envelope = (await paged.json()) as Record<string, unknown>;
      // The audit-logs envelope shape (R127-L5) over the same DTO rows.
      expect(Array.isArray(envelope)).toBe(false);
      expect(envelope).toMatchObject({ total: 2, page: 1, limit: 20, hasMore: false });
      expect(
        (envelope.notifications as Array<Record<string, unknown>>).map((n) => n.title),
      ).toEqual(["إشعار 2", "إشعار 1"]);
      // The paged rows carry the SAME DTO keys as the bell rows.
      expect(
        Object.keys((envelope.notifications as Array<Record<string, unknown>>)[0]).sort(),
      ).toEqual(["created_at", "id", "is_read", "link", "message", "title", "type"].sort());
      // An EMPTY ?page= value degenerates to the bell shape (documented
      // in the route — opt-in is by NAMING the param with a value).
      const empty = await fetch(`${url}/api/notifications?page=`, {
        headers: { Cookie: `auth_token=${user.token}` },
      });
      expect(Array.isArray(await empty.json())).toBe(true);
    } finally {
      close();
    }
  });

  it("page/limit slice newest-first; hasMore is honest on the last page", async () => {
    const user = await seedUser();
    for (let i = 1; i <= 5; i += 1) {
      await seedNotification(user.id, i, false, new Date(Date.UTC(2026, 9, i)));
    }

    const { url, close } = await listen(buildApp());
    try {
      const page1 = (await (
        await fetch(`${url}/api/notifications?page=1&limit=2`, {
          headers: { Cookie: `auth_token=${user.token}` },
        })
      ).json()) as {
        notifications: Array<{ title: string }>;
        total: number;
        page: number;
        limit: number;
        hasMore: boolean;
      };
      expect(page1).toMatchObject({ total: 5, page: 1, limit: 2, hasMore: true });
      expect(page1.notifications.map((n) => n.title)).toEqual(["إشعار 5", "إشعار 4"]);

      const page3 = (await (
        await fetch(`${url}/api/notifications?page=3&limit=2`, {
          headers: { Cookie: `auth_token=${user.token}` },
        })
      ).json()) as {
        notifications: Array<{ title: string }>;
        total: number;
        page: number;
        limit: number;
        hasMore: boolean;
      };
      expect(page3).toMatchObject({ total: 5, page: 3, limit: 2, hasMore: false });
      expect(page3.notifications.map((n) => n.title)).toEqual(["إشعار 1"]);
    } finally {
      close();
    }
  });

  it("garbage page/limit clamp (NaN → defaults, limit caps at 100)", async () => {
    const user = await seedUser();
    const { url, close } = await listen(buildApp());
    try {
      const res = await fetch(`${url}/api/notifications?page=abc&limit=99999`, {
        headers: { Cookie: `auth_token=${user.token}` },
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ page: 1, limit: 100, hasMore: false });
    } finally {
      close();
    }
  });

  it("same-timestamp rows order by id DESC (the stable-offset tiebreaker)", async () => {
    const user = await seedUser();
    const ts = new Date("2026-10-01T10:00:00Z");
    await seedNotification(user.id, 1, false, ts);
    await seedNotification(user.id, 2, false, ts);

    const { url, close } = await listen(buildApp());
    try {
      const res = await fetch(`${url}/api/notifications?page=1&limit=1`, {
        headers: { Cookie: `auth_token=${user.token}` },
      });
      const titles = (
        (await res.json()) as { notifications: Array<{ title: string }> }
      ).notifications.map((n) => n.title);
      // Same created_at → the higher id (seeded second) leads; offset
      // pages can never shuffle the pair.
      expect(titles).toEqual(["إشعار 2"]);
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
      const [row] = await db.select().from(notificationsTable).where(eq(notificationsTable.id, id));
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
