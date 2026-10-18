import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { adminUsersTable, db, initTestDb, productsTable, resetTestDb } from "../../../test/db";
import { signAdminToken } from "../../../lib/jwt";
import { adminProductsRouter } from "../products";

/**
 * R163 — the features[] write surface (the census's known gap closed).
 *
 * products.features (jsonb string[]) rendered on every PDP's «المزايا»
 * checklist but had NO admin write path — 4 census findings (F9, F12,
 * F18, F36) touch bullets the operator could not edit. The PATCH body now
 * carries the array (spec-capped: ≤32 items, each 1–500 chars); this
 * file pins the route contract:
 *
 *   - PATCH with a list persists it (each bullet TRIMMED, blank lines
 *     dropped — a textarea's stray newlines can never mint empty items);
 *   - PATCH WITHOUT the field leaves the stored list untouched;
 *   - PATCH with [] CLEARS the checklist (an explicit operator action);
 *   - the admin LIST projection round-trips features (the editor seeds
 *     from it — the R125-I3 write-only-editor lesson);
 *   - the zod perimeter rejects >32 items (400, never a DB 500).
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
      username: "admin_features_r163",
      passwordHash: "not-a-real-hash",
      isActive: true,
      permissions: ["all"],
    })
    .returning();
  return signAdminToken({ adminId: a.id, role: "admin" });
}

async function call(
  url: string,
  path: string,
  method: "GET" | "PATCH",
  token: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${url}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${token}`,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function seedProduct(features?: string[]): Promise<number> {
  const [p] = await db
    .insert(productsTable)
    .values({
      name: "ExpressVPN",
      slug: "expressvpn-features-test",
      price: "100.00",
      category: "vpn",
      isActive: true,
      ...(features ? { features } : {}),
    })
    .returning({ id: productsTable.id });
  return p.id;
}

let app: Express;
let token: string;

beforeAll(async () => {
  await initTestDb();
  app = buildApp();
  token = await seedAdminToken();
});

beforeEach(async () => {
  await resetTestDb();
  token = await seedAdminToken();
});

describe("R163 — PATCH /products/:id features[] write surface", () => {
  it("persists a feature list, trimming bullets and dropping whitespace-only lines", async () => {
    const id = await seedProduct();
    const { url, close } = await listen(app);
    try {
      const res = await call(url, `/api/admin/products/${id}`, "PATCH", token, {
        features: ["  خوادم في 113 دولة  ", "   ", "تشغيل على كل الأجهزة"],
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id,
        features: ["خوادم في 113 دولة", "تشغيل على كل الأجهزة"],
      });
      const [row] = await db.select().from(productsTable).where(eq(productsTable.id, id));
      expect(row.features).toEqual(["خوادم في 113 دولة", "تشغيل على كل الأجهزة"]);
    } finally {
      close();
    }
  });

  it("an EMPTY-STRING bullet is rejected at the zod perimeter (400) — clients send trimmed lists", async () => {
    const id = await seedProduct();
    const { url, close } = await listen(app);
    try {
      const res = await call(url, `/api/admin/products/${id}`, "PATCH", token, {
        features: ["ميزة سليمة", ""],
      });
      expect(res.status).toBe(400);
    } finally {
      close();
    }
  });

  it("a PATCH WITHOUT the field leaves the stored list untouched", async () => {
    const id = await seedProduct(["ميزة موجودة مسبقاً"]);
    const { url, close } = await listen(app);
    try {
      const res = await call(url, `/api/admin/products/${id}`, "PATCH", token, {
        description: "وصف جديد فقط",
      });
      expect(res.status).toBe(200);
      const [row] = await db.select().from(productsTable).where(eq(productsTable.id, id));
      expect(row.features).toEqual(["ميزة موجودة مسبقاً"]);
    } finally {
      close();
    }
  });

  it("an explicit EMPTY array clears the checklist (a deliberate operator action)", async () => {
    const id = await seedProduct(["ميزة سيتم حذفها"]);
    const { url, close } = await listen(app);
    try {
      const res = await call(url, `/api/admin/products/${id}`, "PATCH", token, { features: [] });
      expect(res.status).toBe(200);
      const [row] = await db.select().from(productsTable).where(eq(productsTable.id, id));
      expect(row.features).toEqual([]);
    } finally {
      close();
    }
  });

  it("the admin LIST projection round-trips features (the editor's seed source)", async () => {
    await seedProduct(["ميزة أ", "ميزة ب"]);
    const { url, close } = await listen(app);
    try {
      const res = await call(url, "/api/admin/products", "GET", token);
      expect(res.status).toBe(200);
      const rows = res.body as Array<{ features?: string[] }>;
      const ours = rows.find((r) => r.features?.includes("ميزة أ"));
      expect(ours?.features).toEqual(["ميزة أ", "ميزة ب"]);
    } finally {
      close();
    }
  });

  it("null rows (never-curated products) project as [] — never null", async () => {
    await seedProduct(undefined); // features column left NULL
    const { url, close } = await listen(app);
    try {
      const res = await call(url, "/api/admin/products", "GET", token);
      expect(res.status).toBe(200);
      const rows = res.body as Array<{ features?: string[]; slug?: string | null }>;
      const ours = rows.find((r) => r.slug === "expressvpn-features-test");
      expect(ours?.features).toEqual([]);
    } finally {
      close();
    }
  });

  it("the zod perimeter rejects a >32-item list (400, never a DB error)", async () => {
    const id = await seedProduct();
    const { url, close } = await listen(app);
    try {
      const res = await call(url, `/api/admin/products/${id}`, "PATCH", token, {
        features: Array.from({ length: 33 }, (_, i) => `ميزة ${i + 1}`),
      });
      expect(res.status).toBe(400);
    } finally {
      close();
    }
  });

  it("a >500-char bullet is rejected at the perimeter (400)", async () => {
    const id = await seedProduct();
    const { url, close } = await listen(app);
    try {
      const res = await call(url, `/api/admin/products/${id}`, "PATCH", token, {
        features: ["ط".repeat(501)],
      });
      expect(res.status).toBe(400);
    } finally {
      close();
    }
  });
});
