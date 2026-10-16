import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import { eq } from "drizzle-orm";
import { db, initTestDb, resetTestDb, usersTable } from "../../test/db";
import { requireAdmin } from "../../middlewares/requireAdmin";
import { adminUsersRouter } from "../../routes/admin/users";

/**
 * R154 (P3-D) — the admin users directory search now covers every STORED
 * identity dimension (id, phone, display name, email, Telegram @username,
 * Telegram identity id), case-insensitively, with the LIKE wildcards
 * escaped. The response also carries the Telegram identity pair
 * (telegram_username / telegram_id) so rows render placeholders honestly.
 */

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/admin", requireAdmin, adminUsersRouter);
  return app;
}

const app = buildApp();

async function listen(): Promise<{ url: string; close: () => void }> {
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

let adminToken = "";

async function seedAdmin(): Promise<string> {
  const { adminUsersTable } = await import("@workspace/db");
  const [a] = await db
    .insert(adminUsersTable)
    .values({ username: "admin_users_search", passwordHash: "x", isActive: true })
    .returning();
  const { signAdminToken } = await import("../../lib/jwt");
  return signAdminToken({ adminId: a.id, role: "admin" });
}

async function get(url: string, path: string) {
  const res = await fetch(`${url}${path}`, {
    headers: { Cookie: `admin_token=${adminToken}` },
  });
  return { status: res.status, body: (await res.json()) as Array<Record<string, unknown>> };
}

beforeAll(async () => {
  await initTestDb();
});

beforeEach(async () => {
  await resetTestDb();
  // Seed AFTER the reset — the token's admin row must survive the
  // truncation for requireAdmin's session-liveness read.
  adminToken = await seedAdmin();
});

describe("R154 — admin users directory multi-identity search", () => {
  it("searches by display name, email, Telegram @username, and Telegram id — case-insensitively", async () => {
    await db.insert(usersTable).values([
      {
        phone: "0911111111",
        displayName: "أحمد الفيتوري",
        email: "ahmed@example.com",
        telegramId: "987654321",
        telegramUsername: "Ahmed_Fitori",
        authProvider: "telegram",
        walletBalance: "0.00",
      },
      {
        phone: "0922222222",
        displayName: "Sara",
        walletBalance: "0.00",
      },
    ]);
    const { url, close } = await listen();
    try {
      // Display name (case-insensitive ASCII).
      const byName = await get(url, "/api/admin/users?search=sara");
      expect(byName.status).toBe(200);
      expect(byName.body.map((u) => u.phone)).toEqual(["0922222222"]);

      // Email.
      const byEmail = await get(url, "/api/admin/users?search=ahmed%40example.com");
      expect(byEmail.body.map((u) => u.phone)).toEqual(["0911111111"]);

      // Telegram username — case-insensitive + without the @.
      const byUsername = await get(url, "/api/admin/users?search=ahmed_fitori");
      expect(byUsername.body.map((u) => u.phone)).toEqual(["0911111111"]);

      // Classic Telegram id (the verified identity key).
      const byTgId = await get(url, "/api/admin/users?search=987654321");
      expect(byUsername.body.map((u) => u.phone)).toEqual(["0911111111"]);
      expect(byTgId.body.map((u) => u.phone)).toEqual(["0911111111"]);

      // Internal user id.
      const [row] = await db.select().from(usersTable).where(eq(usersTable.phone, "0911111111"));
      const byId = await get(url, `/api/admin/users?search=${row.id}`);
      expect(byId.body.map((u) => u.phone)).toEqual(["0911111111"]);

      // Phone still works (the pre-R154 behavior).
      const byPhone = await get(url, "/api/admin/users?search=0911111111");
      expect(byPhone.body.map((u) => u.phone)).toEqual(["0911111111"]);
    } finally {
      close();
    }
  });

  it("LIKE wildcards are escaped — a bare % matches nothing extra", async () => {
    await db.insert(usersTable).values([
      { phone: "0933333333", displayName: "Alpha", walletBalance: "0.00" },
      { phone: "0944444444", displayName: "Beta", walletBalance: "0.00" },
    ]);
    const { url, close } = await listen();
    try {
      const res = await get(url, "/api/admin/users?search=%25");
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(0);
    } finally {
      close();
    }
  });

  it("the response carries the Telegram identity pair", async () => {
    await db.insert(usersTable).values({
      phone: "tg_111222333",
      telegramId: "111222333",
      telegramUsername: "libyan_user",
      displayName: "مشتري تيليجرام",
      authProvider: "telegram",
      walletBalance: "0.00",
    });
    const { url, close } = await listen();
    try {
      const res = await get(url, "/api/admin/users?search=libyan_user");
      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toMatchObject({
        telegram_id: "111222333",
        telegram_username: "libyan_user",
        has_telegram: true,
      });
    } finally {
      close();
    }
  });
});
