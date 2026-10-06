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

let seoRouter: typeof import("../seo")["default"];
let bumpSitemapCache: typeof import("../seo")["bumpSitemapCache"];

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
      for (const allow of ["Allow: /", "Allow: /product/", "Allow: /category/", "Allow: /support", "Allow: /terms"]) {
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
      for (const disallow of ["Disallow: /admin", "Disallow: /admin/", "Disallow: /status", "Disallow: /api/"]) {
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
      { name: "Archived One", slug: "archived-one", price: "10.00", isActive: true, isArchived: true },
      { name: "Inactive One", slug: "inactive-one", price: "10.00", isActive: false, isArchived: false },
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
