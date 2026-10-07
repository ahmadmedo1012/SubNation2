import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { adminUsersTable, db, initTestDb, productsTable, resetTestDb } from "../../../test/db";
import { signAdminToken } from "../../../lib/jwt";
import { adminProductsRouter } from "../products";

/**
 * R122 (A7-P2 + A4-P2-3) — the seo_title / seo_description write paths.
 *
 * products.seo_title (varchar 200) and seo_description (varchar 320) were
 * read on every product surface (detail DTO, hydrated MetaTags) but had
 * ZERO write paths — write-orphaned columns the operator could never
 * maintain. The admin create/update zod now carries both (nullable,
 * column-capped in the spec so the generated schema rejects overlong
 * values at the perimeter), and this file pins the route passthrough:
 *
 *   - POST with the fields persists them; POST without leaves them NULL;
 *   - PATCH with the fields persists them; an explicit null CLEARS them
 *     (the cost_price explicit-null contract); a PATCH without them
 *     leaves stored values untouched;
 *   - over-long values (201 / 321 chars) are rejected 400 INVALID_DATA by
 *     the zod maxLength — never a 22001 500 at the INSERT — while the
 *     column boundaries (200 / 320) are accepted.
 */

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/admin", adminProductsRouter);
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
      username: "admin_seo_fields",
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

const SEO_TITLE = "Netflix — اشتراك أصلي بالدينار الليبي | SubNation";
const SEO_DESCRIPTION = "اشتراك Netflix Premium أصلي بالدينار الليبي مع تسليم فوري بعد الدفع.";

beforeAll(async () => {
  await initTestDb();
});

beforeEach(async () => {
  await resetTestDb();
});

describe("R122 — POST /api/admin/products seo fields", () => {
  it("create WITH seo_title/seo_description persists both on the row", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const token = await seedAdminToken();
      const res = await jsonFetch(url, "/api/admin/products", "POST", token, {
        name: "Netflix Premium",
        price: 63.84,
        category: "streaming",
        seo_title: SEO_TITLE,
        seo_description: SEO_DESCRIPTION,
      });
      expect(res.status).toBe(201);
      const [row] = await db.select().from(productsTable);
      expect(row.seoTitle).toBe(SEO_TITLE);
      expect(row.seoDescription).toBe(SEO_DESCRIPTION);
    } finally {
      close();
    }
  });

  it("create WITHOUT them leaves both NULL (back-compat: the old body shape is untouched)", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const token = await seedAdminToken();
      const res = await jsonFetch(url, "/api/admin/products", "POST", token, {
        name: "Plain Product",
        price: 10,
      });
      expect(res.status).toBe(201);
      const [row] = await db.select().from(productsTable);
      expect(row.seoTitle).toBeNull();
      expect(row.seoDescription).toBeNull();
    } finally {
      close();
    }
  });

  it.each([
    ["seo_title (spec maxLength 200)", "seo_title", "T".repeat(201)],
    ["seo_description (spec maxLength 320)", "seo_description", "D".repeat(321)],
  ])(
    "an over-long %s → 400 INVALID_DATA (zod maxLength, never a 22001 500), nothing inserted",
    async (_label, field, value) => {
      const { url, close } = await listen(buildApp());
      try {
        const token = await seedAdminToken();
        const res = await jsonFetch(url, "/api/admin/products", "POST", token, {
          name: "Bounds Product",
          price: 10,
          [field]: value,
        });
        expect(res.status).toBe(400);
        expect(res.body).toMatchObject({ code: "INVALID_DATA" });
        expect(await db.select().from(productsTable)).toHaveLength(0);
      } finally {
        close();
      }
    },
  );

  it("the column boundaries (200 / 320) are accepted", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const token = await seedAdminToken();
      const res = await jsonFetch(url, "/api/admin/products", "POST", token, {
        name: "Boundary Product",
        price: 10,
        seo_title: "T".repeat(200),
        seo_description: "D".repeat(320),
      });
      expect(res.status).toBe(201);
      const [row] = await db.select().from(productsTable);
      expect(row.seoTitle).toHaveLength(200);
      expect(row.seoDescription).toHaveLength(320);
    } finally {
      close();
    }
  });
});

describe("R122 — PATCH /api/admin/products/:id seo fields", () => {
  async function seedProduct(): Promise<number> {
    const [row] = await db
      .insert(productsTable)
      .values({ name: "Original", price: "5.00", slug: "seo-patch-target" })
      .returning({ id: productsTable.id });
    return row.id;
  }

  it("patch WITH the fields persists them; explicit null CLEARS them (the cost_price contract)", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const token = await seedAdminToken();
      const id = await seedProduct();

      // Set.
      const set = await jsonFetch(url, `/api/admin/products/${id}`, "PATCH", token, {
        seo_title: SEO_TITLE,
        seo_description: SEO_DESCRIPTION,
      });
      expect(set.status).toBe(200);
      let [row] = await db.select().from(productsTable).where(eq(productsTable.id, id));
      expect(row.seoTitle).toBe(SEO_TITLE);
      expect(row.seoDescription).toBe(SEO_DESCRIPTION);

      // Clear via explicit null — the row falls back to the name-based
      // default on every read surface.
      const clear = await jsonFetch(url, `/api/admin/products/${id}`, "PATCH", token, {
        seo_title: null,
        seo_description: null,
      });
      expect(clear.status).toBe(200);
      [row] = await db.select().from(productsTable).where(eq(productsTable.id, id));
      expect(row.seoTitle).toBeNull();
      expect(row.seoDescription).toBeNull();
    } finally {
      close();
    }
  });

  it("a patch WITHOUT the seo fields leaves stored values UNTOUCHED (partial-update semantics)", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const token = await seedAdminToken();
      const id = await seedProduct();
      // Pre-seed overrides directly (the copilot path can set them too).
      await db
        .update(productsTable)
        .set({ seoTitle: SEO_TITLE, seoDescription: SEO_DESCRIPTION })
        .where(eq(productsTable.id, id));

      const res = await jsonFetch(url, `/api/admin/products/${id}`, "PATCH", token, {
        name: "Renamed Only",
      });
      expect(res.status).toBe(200);
      const [row] = await db.select().from(productsTable).where(eq(productsTable.id, id));
      expect(row.name).toBe("Renamed Only");
      expect(row.seoTitle).toBe(SEO_TITLE);
      expect(row.seoDescription).toBe(SEO_DESCRIPTION);
    } finally {
      close();
    }
  });

  it.each([
    ["seo_title", "T".repeat(201)],
    ["seo_description", "D".repeat(321)],
  ])("an over-long %s → 400, the existing row untouched", async (field, value) => {
    const { url, close } = await listen(buildApp());
    try {
      const token = await seedAdminToken();
      const id = await seedProduct();
      const res = await jsonFetch(url, `/api/admin/products/${id}`, "PATCH", token, {
        [field]: value,
      });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: "INVALID_DATA" });
      const [row] = await db.select().from(productsTable).where(eq(productsTable.id, id));
      expect(row.seoTitle).toBeNull();
      expect(row.seoDescription).toBeNull();
    } finally {
      close();
    }
  });
});
