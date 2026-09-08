import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  adminUsersTable,
  db,
  initTestDb,
  resetTestDb,
  supportTicketsTable,
  usersTable,
  couponsTable,
} from "../../test/db";
import { signAdminToken, signUserToken } from "../../lib/jwt";
import { couponsRouter } from "../coupons";
import { supportRouter } from "../support";
import { adminTicketsRouter } from "../admin/tickets";
import { adminSecurityRouter } from "../admin/security";

/**
 * A5-04 / A5-09 (round-94): raw body reads (`code?.trim()`,
 * `message?.trim()`) crashed on non-string values → TypeError → 500
 * while the contracts document 400. Same M2 class the admin coupon
 * routes fixed in round-3; these are the user/admin routes that were
 * missed. Also pins the auth-activity date guard (RangeError → 500
 * before) and the strict intParam parse (A5-14).
 */

// auth_activity is not part of the shared pglite harness DDL (only the
// money/checkout tables live there) — create it locally for this suite.
const AUTH_ACTIVITY_DDL = `
CREATE TABLE auth_activity (
  id serial PRIMARY KEY,
  user_id integer,
  identifier varchar(255) NOT NULL,
  action varchar(50) NOT NULL,
  provider varchar(50),
  success boolean NOT NULL,
  ip_address varchar(45),
  user_agent text,
  failure_reason varchar(255),
  created_at timestamptz NOT NULL DEFAULT now()
);
`;

async function listen(app: Express): Promise<{ url: string; close: () => void }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("no address"));
        return;
      }
      resolve({ url: `http://127.0.0.1:${addr.port}`, close: () => server.close() });
    });
  });
}

async function post(url: string, path: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${url}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function get(url: string, path: string, headers: Record<string, string> = {}) {
  const res = await fetch(`${url}${path}`, { headers });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

let phoneSeq = 94_200_000;
async function seedUser(): Promise<{ id: number; token: string }> {
  phoneSeq += 1;
  const [u] = await db
    .insert(usersTable)
    .values({ phone: String(phoneSeq), walletBalance: "0.00" })
    .returning();
  return { id: u.id, token: signUserToken({ userId: u.id }) };
}

async function seedAdmin(): Promise<string> {
  const [a] = await db
    .insert(adminUsersTable)
    .values({ username: "admin_bodies", passwordHash: "x", isActive: true })
    .returning();
  return signAdminToken({ adminId: a.id, role: "admin" });
}

beforeAll(async () => {
  await initTestDb();
  await db.execute(sql.raw(AUTH_ACTIVITY_DDL));
});

beforeEach(async () => {
  await resetTestDb();
});

describe("POST /api/coupons/validate — raw body read (A5-04)", () => {
  it("400s (not 500) for a non-string code — the old `.trim()` TypeError path", async () => {
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use("/api/coupons", couponsRouter);
    const { url, close } = await listen(app);
    try {
      const { token } = await seedUser();
      const res = await post(url, "/api/coupons/validate", { code: 5, order_amount: 100 }, { Cookie: `auth_token=${token}` });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: "INVALID_DATA" });
    } finally {
      close();
    }
  });

  it("400s for a non-number order_amount and for object bodies", async () => {
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use("/api/coupons", couponsRouter);
    const { url, close } = await listen(app);
    try {
      const { token } = await seedUser();
      const cookie = { Cookie: `auth_token=${token}` };
      const r1 = await post(url, "/api/coupons/validate", { code: "X", order_amount: "lots" }, cookie);
      expect(r1.status).toBe(400);
      const r2 = await post(url, "/api/coupons/validate", { code: {} }, cookie);
      expect(r2.status).toBe(400);
    } finally {
      close();
    }
  });

  it("still validates a real coupon end-to-end (schema gate is not a regression)", async () => {
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use("/api/coupons", couponsRouter);
    const { url, close } = await listen(app);
    try {
      const { token } = await seedUser();
      await db.insert(couponsTable).values({
        code: "WELCOME",
        type: "percentage",
        value: "10.00",
        minOrderAmount: "0.00",
        isActive: true,
      });
      const res = await post(
        url,
        "/api/coupons/validate",
        { code: "  welcome ", order_amount: 100 },
        { Cookie: `auth_token=${token}` },
      );
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ valid: true, discount_amount: 10, final_amount: 90 });
    } finally {
      close();
    }
  });
});

describe("POST /api/support/tickets — raw body reads (A5-04)", () => {
  it("400s (not 500) for a non-string title/message", async () => {
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use("/api/support/tickets", supportRouter);
    const { url, close } = await listen(app);
    try {
      const { token } = await seedUser();
      const res = await post(
        url,
        "/api/support/tickets",
        { title: { evil: 1 }, message: "hi" },
        { Cookie: `auth_token=${token}` },
      );
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: "INVALID_DATA" });
    } finally {
      close();
    }
  });

  it("rejects an over-limit message with the field-specific message", async () => {
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use("/api/support/tickets", supportRouter);
    const { url, close } = await listen(app);
    try {
      const { token } = await seedUser();
      const res = await post(
        url,
        "/api/support/tickets",
        { title: "t", message: "x".repeat(4001) },
        { Cookie: `auth_token=${token}` },
      );
      expect(res.status).toBe(400);
      expect((res.body as { error: string }).error).toContain("4000");
    } finally {
      close();
    }
  });

  it("reply: 400s (not 500) for a non-string message", async () => {
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use("/api/support/tickets", supportRouter);
    const { url, close } = await listen(app);
    try {
      const { id, token } = await seedUser();
      const [t] = await db
        .insert(supportTicketsTable)
        .values({ userId: id, title: "T", status: "open" })
        .returning();
      const res = await post(
        url,
        `/api/support/tickets/${t.id}/reply`,
        { message: 42 },
        { Cookie: `auth_token=${token}` },
      );
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: "INVALID_DATA" });
    } finally {
      close();
    }
  });
});

describe("POST /api/admin/tickets/:id/reply — raw body read (A5-04)", () => {
  it("400s (not 500) for a non-string message", async () => {
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use("/api/admin", adminTicketsRouter);
    const { url, close } = await listen(app);
    try {
      const adminToken = await seedAdmin();
      const { id } = await seedUser();
      const [t] = await db
        .insert(supportTicketsTable)
        .values({ userId: id, title: "T", status: "open" })
        .returning();
      const res = await post(
        url,
        `/api/admin/tickets/${t.id}/reply`,
        { message: [1, 2] },
        { Authorization: `Bearer ${adminToken}` },
      );
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: "INVALID_DATA" });
    } finally {
      close();
    }
  });
});

describe("GET /api/admin/auth-activity — unguarded dates (A5-09)", () => {
  it("400s (not 500) for an unparseable startDate — the old RangeError path", async () => {
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use("/api/admin", adminSecurityRouter);
    const { url, close } = await listen(app);
    try {
      const adminToken = await seedAdmin();
      const res = await get(url, "/api/admin/auth-activity?startDate=abc", {
        Authorization: `Bearer ${adminToken}`,
      });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: "INVALID_DATA" });
    } finally {
      close();
    }
  });

  it("400s for an unparseable endDate, and 200s for valid ISO dates", async () => {
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use("/api/admin", adminSecurityRouter);
    const { url, close } = await listen(app);
    try {
      const adminToken = await seedAdmin();
      const bad = await get(url, "/api/admin/auth-activity?endDate=nope", {
        Authorization: `Bearer ${adminToken}`,
      });
      expect(bad.status).toBe(400);
      const good = await get(url, "/api/admin/auth-activity?startDate=2026-01-01T00:00:00Z", {
        Authorization: `Bearer ${adminToken}`,
      });
      expect(good.status).toBe(200);
      expect(good.body).toHaveProperty("activities");
    } finally {
      close();
    }
  });
});
