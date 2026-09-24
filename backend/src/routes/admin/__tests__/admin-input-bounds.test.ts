import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { adminUsersTable, db, initTestDb, productsTable, resetTestDb } from "../../../test/db";
import { signAdminToken } from "../../../lib/jwt";
import { requireAdmin } from "../../../middlewares/requireAdmin";
import { adminProductsRouter } from "../products";
import { adminAdminsRouter } from "../admins";
import { adminAuthRouter } from "../auth";

/**
 * B2-F3 (R111, round-111 B2 audit): admin-side input bounds aligned with
 * the DB columns. The generated Create/UpdateProductBody schemas carry no
 * string bounds, but products.name / category / image_url are
 * varchar(255/100/1000) — an over-long value reached the INSERT/UPDATE
 * and 500'd (22001) instead of answering 400. Same class on
 * admin-creation: admin_users.username is varchar(100) (unbounded → 500)
 * and admin_users.display_name is varchar(100) (the old routes sliced at
 * 200 — still an overflow). All bounds are handler-enforced with a clear
 * Arabic message, mirroring product-variants.ts's discipline.
 */

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  // adminProductsRouter guards its own routes with requireAdmin; the
  // admins router relies on the parent mount (admin/index.ts) — replicate
  // it here. adminAuthRouter (/profile) guards itself.
  app.use("/api/admin", adminProductsRouter);
  app.use("/api/admin/admins", requireAdmin, adminAdminsRouter);
  app.use("/api/admin", adminAuthRouter);
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

async function seedAdminToken(): Promise<string> {
  const [a] = await db
    .insert(adminUsersTable)
    .values({
      username: "admin_bounds",
      passwordHash: "not-a-real-hash",
      isActive: true,
      permissions: ["all"],
    })
    .returning();
  return signAdminToken({ adminId: a.id, role: "admin" });
}

async function jsonFetch(
  url: string,
  path: string,
  method: "POST" | "PATCH",
  token: string,
  body: unknown,
): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const res = await fetch(`${url}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : null };
}

beforeAll(async () => {
  await initTestDb();
});

beforeEach(async () => {
  await resetTestDb();
});

describe("B2-F3 — POST /api/admin/products column-aligned bounds", () => {
  it.each([
    ["name (varchar 255)", "name", "N".repeat(256), "اسم المنتج"],
    ["category (varchar 100)", "category", "C".repeat(101), "الفئة"],
    ["image_url (varchar 1000)", "image_url", "https://x.test/".padEnd(1001, "i"), "رابط الصورة"],
  ])(
    "an oversized %s → 400 INVALID_DATA, nothing inserted",
    async (_label, field, value, label) => {
      const { url, close } = await listen(buildApp());
      try {
        const token = await seedAdminToken();
        const body: Record<string, unknown> = {
          name: "Bounds Product",
          price: 10,
          [field]: value,
        };
        const res = await jsonFetch(url, "/api/admin/products", "POST", token, body);
        expect(res.status).toBe(400);
        expect(res.body).toMatchObject({ code: "INVALID_DATA" });
        expect((res.body as { error: string }).error).toContain(label);
        expect(await db.select().from(productsTable)).toHaveLength(0);
      } finally {
        close();
      }
    },
  );

  it("boundary values (name 255 / category 100 / image_url 1000) are accepted", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const token = await seedAdminToken();
      const res = await jsonFetch(url, "/api/admin/products", "POST", token, {
        name: "B".repeat(255),
        category: "G".repeat(100),
        image_url: "I".repeat(1000),
        price: 10,
      });
      expect(res.status).toBe(201);
      const rows = await db.select().from(productsTable);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.name).toHaveLength(255);
      expect(rows[0]!.category).toHaveLength(100);
      expect(rows[0]!.imageUrl).toHaveLength(1000);
    } finally {
      close();
    }
  });
});

describe("B2-F3 — PATCH /api/admin/products/:id column-aligned bounds", () => {
  it("an oversized name → 400, the existing row untouched", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const token = await seedAdminToken();
      const [created] = await db
        .insert(productsTable)
        .values({ name: "Original", price: "5.00" })
        .returning();

      const res = await jsonFetch(url, `/api/admin/products/${created.id}`, "PATCH", token, {
        name: "X".repeat(256),
      });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: "INVALID_DATA" });

      const [after] = await db.select().from(productsTable).where(eq(productsTable.id, created.id));
      expect(after.name).toBe("Original");
    } finally {
      close();
    }
  });

  it("an oversized category → 400 (patch path bounds every bounded field)", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const token = await seedAdminToken();
      const [created] = await db
        .insert(productsTable)
        .values({ name: "Original", price: "5.00" })
        .returning();
      const res = await jsonFetch(url, `/api/admin/products/${created.id}`, "PATCH", token, {
        category: "K".repeat(101),
      });
      expect(res.status).toBe(400);
    } finally {
      close();
    }
  });
});

describe("B2-F3 — POST /api/admin/admins username bound (varchar 100)", () => {
  it("a 101-char username → 400 INVALID_DATA (was a 22001 500 at the INSERT)", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const token = await seedAdminToken();
      const res = await jsonFetch(url, "/api/admin/admins", "POST", token, {
        username: "u".repeat(101),
        password: "longenough1",
        permissions: ["orders"],
      });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: "INVALID_DATA" });
      // Only the seeding admin exists.
      const rows = await db.select().from(adminUsersTable);
      expect(rows).toHaveLength(1);
    } finally {
      close();
    }
  });

  it("a 100-char username is accepted at the column boundary", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const token = await seedAdminToken();
      const res = await jsonFetch(url, "/api/admin/admins", "POST", token, {
        username: "v".repeat(100),
        password: "longenough1",
        permissions: ["orders"],
      });
      expect(res.status).toBe(201);
    } finally {
      close();
    }
  });
});

describe("B2-F3 — PATCH /api/admin/profile display_name bound (varchar 100)", () => {
  it("a 101..200-char display_name → 400 (the old 200 bound still overflowed the column)", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const token = await seedAdminToken();
      const res = await jsonFetch(url, "/api/admin/profile", "PATCH", token, {
        display_name: "D".repeat(150),
        current_password: "whatever",
      });
      // The length bound fires BEFORE the password verification — a clean
      // 400, never the 22001 that a stored 150-char name would raise.
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: "INVALID_DATA" });
    } finally {
      close();
    }
  });

  it("a 100-char display_name passes the bound (still password-gated downstream)", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const token = await seedAdminToken();
      const res = await jsonFetch(url, "/api/admin/profile", "PATCH", token, {
        display_name: "E".repeat(100),
        current_password: "whatever",
      });
      // Not the length 400 — the wrong-password 401 (the seeded hash is
      // not argon2; the bound is what this test pins, and it passed).
      expect(res.status).not.toBe(400);
    } finally {
      close();
    }
  });
});
