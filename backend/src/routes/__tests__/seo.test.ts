import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import express, { type Express } from "express";
import { db, initTestDb, productsTable, resetTestDb } from "../../test/db";

/**
 * R118-A5 TOP-20 #16 [P3] — routes/seo.ts (robots.txt + sitemap.xml)
 * had ZERO tests, on either side of the frontend/backend mirror (the
 * SPA's robotsForPath derives from this allow-list).
 *
 * Pinned contracts:
 *   - robots.txt: content-type text/plain; the documented public
 *     allow-list (/, /product/, /category/, /support, /terms) and the
 *     private-surface disallow list (auth flow, cart/checkout funnels,
 *     user-private pages, admin, /status, /api/) — including the
 *     /orders disallow that covers order DETAIL urls; Sitemap: line
 *     points at the APP_ORIGIN sitemap;
 *   - sitemap.xml: content-type application/xml; every <loc> carries
 *     the canonical APP_ORIGIN; ARCHIVED and INACTIVE products are
 *     excluded while active ones are listed by SLUG (id fallback only
 *     for slug-less rows); the static route set (home, 7 categories,
 *     support, terms, flash-sales) is present;
 *   - cache headers on both endpoints.
 *
 * APP_URL is pinned before the module loads (the origin is resolved
 * once at import) — the test origin differs from the production default
 * so the assertions prove the wiring, not a hardcoded host.
 */

const TEST_ORIGIN = "https://seo-contract-test.example";

let seoRouter: (typeof import("../seo"))["default"];
let bumpSitemapCache: (typeof import("../seo"))["bumpSitemapCache"];

beforeAll(async () => {
  process.env.APP_URL = TEST_ORIGIN;
  // Dynamic import so APP_URL is read at module load (seo.ts resolves
  // the origin once, at import time).
  const mod = await import("../seo");
  seoRouter = mod.default;
  bumpSitemapCache = mod.bumpSitemapCache;
  await initTestDb();
});

beforeEach(async () => {
  await resetTestDb();
  bumpSitemapCache();
});

function buildApp(): Express {
  const app = express();
  app.use("/", seoRouter);
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

async function getBody(url: string, path: string) {
  const res = await fetch(`${url}${path}`);
  return {
    status: res.status,
    contentType: res.headers.get("content-type"),
    cacheControl: res.headers.get("cache-control"),
    text: await res.text(),
  };
}

describe("GET /robots.txt (R118-A5 #16)", () => {
  it("serves the allow-list + private-surface disallow list with the right content type", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const res = await getBody(url, "/robots.txt");
      expect(res.status).toBe(200);
      expect(res.contentType).toBe("text/plain; charset=utf-8");
      expect(res.cacheControl).toContain("max-age=300");

      // Public crawlable surface.
      for (const allow of [
        "Allow: /",
        "Allow: /product/",
        "Allow: /category/",
        "Allow: /support",
        "Allow: /terms",
      ]) {
        expect(res.text).toContain(`\n${allow}\n`);
      }

      // Auth flow — never index.
      for (const disallow of [
        "Disallow: /login",
        "Disallow: /register",
        "Disallow: /forgot-password",
        "Disallow: /onboarding",
        "Disallow: /auth/",
      ]) {
        expect(res.text).toContain(`\n${disallow}\n`);
      }

      // Transactional funnels (V3-A2) + user-private pages. NOTE:
      // "Disallow: /orders" also covers the order DETAIL urls
      // (/orders/:id) — prefix matching.
      for (const disallow of [
        "Disallow: /cart",
        "Disallow: /checkout",
        "Disallow: /wallet",
        "Disallow: /orders",
        "Disallow: /loyalty",
        "Disallow: /referrals",
        "Disallow: /profile",
      ]) {
        expect(res.text).toContain(`\n${disallow}\n`);
      }

      // Admin + internal observability + API surface.
      for (const disallow of [
        "Disallow: /admin",
        "Disallow: /admin/",
        "Disallow: /status",
        "Disallow: /api/",
      ]) {
        expect(res.text).toContain(`\n${disallow}\n`);
      }

      // Sitemap pointer at the canonical origin.
      expect(res.text).toContain(`Sitemap: ${TEST_ORIGIN}/sitemap.xml`);
      expect(res.text).toContain("Crawl-delay: 1");
      expect(res.text).toContain("User-agent: *");
    } finally {
      close();
    }
  });
});

describe("GET /sitemap.xml (R118-A5 #16)", () => {
  it("carries the canonical APP_ORIGIN on every <loc>, excludes archived/inactive products, lists active ones by slug", async () => {
    await db.insert(productsTable).values([
      { name: "Live One", slug: "live-one", price: "10.00", isActive: true, isArchived: false },
      {
        name: "Archived One",
        slug: "archived-one",
        price: "10.00",
        isActive: true,
        isArchived: true,
      },
      {
        name: "Inactive One",
        slug: "inactive-one",
        price: "10.00",
        isActive: false,
        isArchived: false,
      },
      { name: "No Slug", slug: null, price: "10.00", isActive: true, isArchived: false },
    ]);

    const { url, close } = await listen(buildApp());
    try {
      const res = await getBody(url, "/sitemap.xml");
      expect(res.status).toBe(200);
      expect(res.contentType).toBe("application/xml; charset=utf-8");
      expect(res.cacheControl).toContain("max-age=60");

      // XML shape.
      expect(res.text).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(res.text).toContain("http://www.sitemaps.org/schemas/sitemap/0.9");

      // Canonical host on product urls.
      expect(res.text).toContain(`<loc>${TEST_ORIGIN}/product/live-one</loc>`);
      // Slug-less row falls back to the id form (never an "null" url).
      expect(res.text).toMatch(new RegExp(`<loc>${TEST_ORIGIN}/product/product-\\d+</loc>`));

      // Excluded: archived + inactive products NEVER appear.
      expect(res.text).not.toContain("/archived-one");
      expect(res.text).not.toContain("/inactive-one");

      // Static route set present (home + the 7 live categories + support
      // + terms + flash-sales) — all on the canonical origin.
      for (const path of [
        "/",
        "/category/streaming",
        "/category/music",
        "/category/software",
        "/category/vpn",
        "/category/ai-tools",
        "/category/seo-tools",
        "/category/education",
        "/support",
        "/terms",
        "/flash-sales",
      ]) {
        expect(res.text).toContain(`<loc>${TEST_ORIGIN}${path}</loc>`);
      }

      // User-private pages are NOT in the sitemap (they render empty for
      // an anonymous crawler — diluting the index).
      for (const absent of ["/wallet", "/orders", "/loyalty", "/referrals", "/profile", "/admin"]) {
        expect(res.text).not.toContain(`<loc>${TEST_ORIGIN}${absent}`);
      }

      // Arabic alternate + x-default for explicit-locale crawlers.
      expect(res.text).toContain('hreflang="ar"');
      expect(res.text).toContain('hreflang="x-default"');
    } finally {
      close();
    }
  });

  // ── R122 (A7-P2): per-route lastmod policy ────────────────────────────────

  it("editorial statics (/terms, /support) OMIT <lastmod>; catalog-driven entries keep it (R122 A7-P2)", async () => {
    await db.insert(productsTable).values({
      name: "Lastmod Product",
      slug: "lastmod-product",
      price: "10.00",
      isActive: true,
      isArchived: false,
    });

    const { url, close } = await listen(buildApp());
    try {
      const res = await getBody(url, "/sitemap.xml");
      expect(res.status).toBe(200);

      // Parse per-entry (a regex from the FIRST <url> would span across
      // sibling entries and match their lastmods too).
      const entries = res.text
        .split("<url>")
        .slice(1)
        .map((chunk) => chunk.split("</url>")[0] ?? "");
      const entryFor = (path: string): string | null =>
        entries.find((e) => e.includes(`<loc>${TEST_ORIGIN}${path}</loc>`)) ?? null;

      // Editorial pages: no honest content-timestamp source exists, and
      // the OLD global MAX(product.updated_at) churned a "fresh" lastmod
      // on every product edit with zero content change — the noisy-field
      // trap. They now omit the tag entirely (sitemap.org: optional).
      expect(entryFor("/terms")).not.toContain("<lastmod>");
      expect(entryFor("/support")).not.toContain("<lastmod>");

      // Catalog-driven routes DID change when products changed — they
      // keep the catalog lastmod (and the entries stay well-formed).
      for (const path of ["/", "/category/vpn", "/flash-sales"]) {
        const entry = entryFor(path);
        expect(entry, `entry for ${path}`).not.toBeNull();
        // R122 main-agent fix: toContain(regex) looks for the regex's
        // LITERAL source string, not a pattern match — toMatch is the
        // regex assertion (same idiom as the product-\d+ check above).
        expect(entry).toMatch(/<lastmod>\d{4}-\d{2}-\d{2}T/);
      }

      // Product entries keep their OWN per-row lastmod (unchanged).
      const productEntry = entryFor("/product/lastmod-product");
      expect(productEntry).toMatch(/<lastmod>\d{4}-\d{2}-\d{2}T/);
    } finally {
      close();
    }
  });

  // ── A11-F5 (R126-L6): per-entity lastmod, not a bulk stamp ────────────────

  it("products with DIVERGENT updated_at get their OWN lastmod values (A11-F5)", async () => {
    // The live sitemap once read as a bulk stamp (all 56 URLs inside a
    // 20 s window) — that window is the 2026-09-20 bulk-import DATA
    // (every row's updated_at genuinely sits there; $onUpdate bumps
    // future edits), not a builder constant. This pin proves the
    // builder emits each row's OWN timestamp so any future edit
    // diverges exactly that product's lastmod.
    const older = new Date("2026-01-05T08:00:00.000Z");
    const newer = new Date("2026-09-20T20:15:10.000Z");
    await db.insert(productsTable).values([
      {
        name: "Older Product",
        slug: "older-lastmod",
        price: "10.00",
        isActive: true,
        isArchived: false,
        updatedAt: older,
      },
      {
        name: "Newer Product",
        slug: "newer-lastmod",
        price: "10.00",
        isActive: true,
        isArchived: false,
        updatedAt: newer,
      },
    ]);

    const { url, close } = await listen(buildApp());
    try {
      const res = await getBody(url, "/sitemap.xml");
      expect(res.status).toBe(200);

      const entries = res.text
        .split("<url>")
        .slice(1)
        .map((chunk) => chunk.split("</url>")[0] ?? "");
      const lastmodFor = (path: string): string => {
        const entry = entries.find((e) => e.includes(`<loc>${TEST_ORIGIN}${path}</loc>`));
        expect(entry, `entry for ${path}`).toBeTruthy();
        const m = entry!.match(/<lastmod>([^<]+)<\/lastmod>/);
        expect(m, `lastmod for ${path}`).toBeTruthy();
        return m![1]!;
      };

      // Each product carries ITS OWN row timestamp — never a shared
      // build-time value, never the other row's.
      expect(lastmodFor("/product/older-lastmod")).toBe(older.toISOString());
      expect(lastmodFor("/product/newer-lastmod")).toBe(newer.toISOString());
      // And the two DIVERGE (the bulk-stamp regression shape).
      expect(lastmodFor("/product/older-lastmod")).not.toBe(lastmodFor("/product/newer-lastmod"));
    } finally {
      close();
    }
  });

  it("a newly-inserted product appears after the cache is bumped (60 s TTL bypassed by bumpSitemapCache)", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const cold = await getBody(url, "/sitemap.xml");
      expect(cold.text).not.toContain("/product/fresh-product");

      await db.insert(productsTable).values({
        name: "Fresh Product",
        slug: "fresh-product",
        price: "10.00",
        isActive: true,
        isArchived: false,
      });
      bumpSitemapCache(); // the admin product-CRUD invalidation hook

      const warm = await getBody(url, "/sitemap.xml");
      expect(warm.text).toContain(`<loc>${TEST_ORIGIN}/product/fresh-product</loc>`);
    } finally {
      close();
    }
  });
});
