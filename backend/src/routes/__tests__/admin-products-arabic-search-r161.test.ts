import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { adminUsersTable, db, initTestDb, productsTable, resetTestDb } from "../../test/db";
import { signAdminToken } from "../../lib/jwt";
import { adminProductsRouter } from "../admin/products";

/**
 * R161-D — the ADMIN products search speaks Arabic.
 *
 * The storefront catalog route has expanded Arabic queries since R122/R132
 * (lib/arabic-search), but the admin list stayed a raw lowercase ILIKE over
 * the English product names + English category slugs: an operator who
 * thinks in Arabic typed «نتفلكس» and found NOTHING to edit or restock.
 * The sweep now ORs the same bounded expansion beside the raw condition
 * (name ILIKEs for nameTerms/latinTerms, category equality for categories;
 * compounds and variantTerms stay public-route ranking machinery).
 *
 * Pins the invariants the change must NOT disturb:
 *   - pure-English queries keep the raw whole-string semantics (the
 *     expansion is empty for them — the R122 invariant);
 *   - the archived-row guard still ANDs with the search condition;
 *   - the unauthenticated request still 401s (requireAdmin);
 *   - the 200-row admin-table cap still applies with the category branch
 *     active (Round-3 8-c §3.4).
 */

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  // The router carries its own per-route requireAdmin (the set-count-trim
  // sibling mount — no extra RBAC layer needed for these pins).
  app.use("/api/admin", adminProductsRouter);
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
  const [a] = await db
    .insert(adminUsersTable)
    .values({ username: "admin_products_arabic", passwordHash: "x", isActive: true })
    .returning();
  return signAdminToken({ adminId: a.id, role: "admin" });
}

type AdminProductRow = {
  id: number;
  name: string;
  category: string | null;
  variants: unknown[];
};

async function get(
  url: string,
  path: string,
): Promise<{ status: number; body: AdminProductRow[] }> {
  const res = await fetch(`${url}${path}`, {
    headers: { Cookie: `admin_token=${adminToken}` },
  });
  const body = (await res.json()) as AdminProductRow[];
  return { status: res.status, body };
}

/** Search by name over the admin list payload. */
async function searchNames(url: string, query: string): Promise<string[]> {
  const { status, body } = await get(
    url,
    `/api/admin/products?search=${encodeURIComponent(query)}`,
  );
  expect(status, `search=${JSON.stringify(query)} must be 200 (no SQL errors)`).toBe(200);
  return body.map((p) => p.name);
}

/** Live-catalog-shaped seed: English names, the four task families. */
async function seedAdminCatalog() {
  await db.insert(productsTable).values([
    { name: "Netflix Premium", slug: "netflix-premium", price: "79.80", category: "streaming" },
    {
      name: "Disney+ Standard",
      slug: "disney-plus-standard",
      price: "49.80",
      category: "streaming",
    },
    { name: "Spotify Premium", slug: "spotify-premium", price: "59.80", category: "music" },
    { name: "Apple Music Family", slug: "apple-music-family", price: "39.00", category: "music" },
    { name: "Windows 10 Pro", slug: "windows-10-pro", price: "119.00", category: "software" },
    { name: "ExpressVPN", slug: "expressvpn", price: "89.00", category: "vpn" },
    // Invisible row — the search condition must still AND with the
    // archived filter (the admin list never shows archived products).
    {
      name: "Netflix Legacy Archive",
      slug: "netflix-legacy",
      price: "10.00",
      category: "streaming",
      isArchived: true,
    },
  ]);
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

describe("R161-D — admin product search speaks Arabic (R122/R132 parity)", () => {
  it("«نتفلكس» (and «نتفليكس») finds the Netflix product — and nothing else", async () => {
    await seedAdminCatalog();
    const { url, close } = await listen();
    try {
      const { status, body } = await get(
        url,
        `/api/admin/products?search=${encodeURIComponent("نتفلكس")}`,
      );
      expect(status).toBe(200);
      expect(body.map((p) => p.name)).toEqual(["Netflix Premium"]);
      // The response keeps the admin projection's shape (the row the
      // editor/restock UI renders).
      expect(body[0]).toMatchObject({
        name: "Netflix Premium",
        category: "streaming",
        variants: [],
      });
      // The standard Arabic spelling resolves too.
      await expect(searchNames(url, "نتفليكس")).resolves.toEqual(["Netflix Premium"]);
    } finally {
      close();
    }
  });

  it("«موسيقى» returns the music-category rows (the category branch)", async () => {
    await seedAdminCatalog();
    const { url, close } = await listen();
    try {
      const names = await searchNames(url, "موسيقى");
      expect(names).toHaveLength(2);
      expect(names).toEqual(expect.arrayContaining(["Spotify Premium", "Apple Music Family"]));
      expect(names).not.toContain("Netflix Premium");
      expect(names).not.toContain("Windows 10 Pro");
      expect(names).not.toContain("ExpressVPN");
    } finally {
      close();
    }
  });

  it("mixed script: «netflix اشتراك» finds Netflix (the latinTerms branch)", async () => {
    await seedAdminCatalog();
    const { url, close } = await listen();
    try {
      await expect(searchNames(url, "netflix اشتراك")).resolves.toEqual(["Netflix Premium"]);
    } finally {
      close();
    }
  });

  it("«نتفلكس شهر» keeps its recall — the duration rider narrows nothing (compounds/variantTerms are public-route ranking, skipped here by design)", async () => {
    await seedAdminCatalog();
    const { url, close } = await listen();
    try {
      await expect(searchNames(url, "نتفلكس شهر")).resolves.toEqual(["Netflix Premium"]);
    } finally {
      close();
    }
  });

  it("pure-English queries keep the raw whole-string semantics (empty expansion — the R122 invariant)", async () => {
    await seedAdminCatalog();
    const { url, close } = await listen();
    try {
      await expect(searchNames(url, "netflix")).resolves.toEqual(["Netflix Premium"]);
      await expect(searchNames(url, "NETFLIX")).resolves.toEqual(["Netflix Premium"]);
      // Multi-word English stays a WHOLE-STRING match — no per-token
      // widening (the response-level fingerprint of "no expansion
      // branches"; the SQL shape stays the route's business).
      await expect(searchNames(url, "storage lifetime")).resolves.toEqual([]);
    } finally {
      close();
    }
  });

  it("an unrelated Arabic string returns [] cleanly (no SQL error, no brand false-positive)", async () => {
    await seedAdminCatalog();
    const { url, close } = await listen();
    try {
      await expect(searchNames(url, "خدمة توصيل طعام")).resolves.toEqual([]);
    } finally {
      close();
    }
  });

  it("auth-gated: no admin token → 401 (the requireAdmin guard is untouched)", async () => {
    await seedAdminCatalog();
    const { url, close } = await listen();
    try {
      const res = await fetch(`${url}/api/admin/products?search=${encodeURIComponent("نتفلكس")}`);
      expect(res.status).toBe(401);
    } finally {
      close();
    }
  });

  it("the 200-row cap still applies with the category expansion active (Round-3 8-c §3.4)", async () => {
    // 205 music rows: «موسيقى» matches them ALL through the category
    // branch — the response stays capped at the admin table's 200.
    await db.insert(productsTable).values(
      Array.from({ length: 205 }, (_, i) => ({
        name: `Cap Product ${i}`,
        price: "5.00",
        category: "music",
      })),
    );
    const { url, close } = await listen();
    try {
      const { status, body } = await get(
        url,
        `/api/admin/products?search=${encodeURIComponent("موسيقى")}`,
      );
      expect(status).toBe(200);
      expect(body).toHaveLength(200);
    } finally {
      close();
    }
  });
});
