import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import express, { type Express } from "express";
import { readFileSync } from "node:fs";
import path from "node:path";
import { db, initTestDb, productsTable, resetTestDb } from "../../test/db";

/**
 * R118-A5 TOP-20 #16 [P3] — routes/seo.ts (robots.txt + sitemap.xml)
 * had ZERO tests, on either side of the frontend/backend mirror (the
 * SPA's robotsForPath derives from this allow-list).
 *
 * Pinned contracts:
 *   - robots.txt: content-type text/plain; the documented public
 *     allow-list (/, /product/, /category/, /flash-sales, /support,
 *     /terms) and the private-surface disallow list (auth flow,
 *     cart/checkout funnels, user-private pages incl. /notifications,
 *     admin, /status, /api/) — including the /orders disallow that
 *     covers order DETAIL urls; Sitemap: line points at the APP_ORIGIN
 *     sitemap;
 *   - sitemap.xml: content-type application/xml; every <loc> carries
 *     the canonical APP_ORIGIN; ARCHIVED and INACTIVE products are
 *     excluded while active ones are listed by SLUG (slug-less rows
 *     are omitted — the R166 honest-omission rule); the static route
 *     set (home, 7 categories, support, terms, flash-sales) is present;
 *   - cache headers on both endpoints.
 *
 * r140-m (lane: sitemap/robots freshness + parity) added:
 *   - the robots walls are FROZEN as the EXACT Allow/Disallow line set
 *     (any wall edit must consciously re-pin this suite);
 *   - route PARITY against the LIVE frontend registries, read as text
 *     (the spa-shell-category-parity idiom): every route the SPA mounts
 *     that its own NOINDEX_ROUTES (route-shapes.ts) classifies private
 *     is robots-blocked, and every indexable one stays crawlable — the
 *     pin that would have caught the R128-IMP-5 /notifications gap;
 *   - the sitemap's static URL set is EXACTLY the SPA's indexable
 *     static routes + the live CATEGORY_META slugs (frontend/src/lib/
 *     categories.ts — the documented SSOT), with the /products alias
 *     redirect and the retired gaming/productivity categories pinned
 *     ABSENT;
 *   - per-category lastmod honesty: each /category/<slug> entry carries
 *     MAX(updated_at) of THAT category's rows (home + /flash-sales keep
 *     the global MAX — they render the whole catalog).
 *
 * APP_URL is pinned before the module loads (the origin is resolved
 * once at import) — the test origin differs from the production default
 * so the assertions prove the wiring, not a hardcoded host.
 */

const TEST_ORIGIN = "https://seo-contract-test.example";

// R158 (B#9): seo.ts joined the named-export convention.
let seoRouter: (typeof import("../seo"))["seoRouter"];
let bumpSitemapCache: (typeof import("../seo"))["bumpSitemapCache"];

beforeAll(async () => {
  process.env.APP_URL = TEST_ORIGIN;
  // Dynamic import so APP_URL is read at module load (seo.ts resolves
  // the origin once, at import time).
  const mod = await import("../seo");
  seoRouter = mod.seoRouter;
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

// ── r140-m: frontend registries, read as TEXT (spa-shell-parity idiom) ──────
//
// backend/src cannot import frontend modules (tsconfig rootDir: "src"),
// so the LIVE route inventory is parsed from the frontend sources at
// test time. The SPA's own noindex classification (route-shapes.ts
// NOINDEX_ROUTES) is the privacy source of truth; routes.tsx is the
// mounted-route inventory; categories.ts is the documented SSOT for the
// backend sitemap's category set.

const FRONTEND_APP_DIR = path.resolve(import.meta.dirname, "../../../../frontend/src/app");
const ROUTES_TSX = readFileSync(path.join(FRONTEND_APP_DIR, "routes.tsx"), "utf8");
const ROUTE_SHAPES_TS = readFileSync(path.join(FRONTEND_APP_DIR, "route-shapes.ts"), "utf8");
const CATEGORIES_TS = readFileSync(
  path.resolve(import.meta.dirname, "../../../../frontend/src/lib/categories.ts"),
  "utf8",
);

/** Concrete <Route path="…"> literals from the SPA registry (both the storefront Switch and the admin Switch). */
const SPA_PATHS: string[] = [...ROUTES_TSX.matchAll(/path="([^"]+)"/g)].map((m) => m[1] as string);

/** The SPA's own noindex regexes, compiled from route-shapes.ts text. */
const NOINDEX_REGEXES: RegExp[] = (() => {
  const start = ROUTE_SHAPES_TS.indexOf("const NOINDEX_ROUTES");
  if (start === -1) throw new Error("NOINDEX_ROUTES not found in route-shapes.ts");
  const block = ROUTE_SHAPES_TS.slice(start, ROUTE_SHAPES_TS.indexOf("];", start));
  const regexes = [...block.matchAll(/(\/\^\S+)\/,/g)].map((m) => new RegExp(m[1]!.slice(1)));
  if (regexes.length < 10)
    throw new Error(`NOINDEX_ROUTES extraction found only ${regexes.length} entries`);
  return regexes;
})();

/** "/orders/ABC" → ["/orders/ABC", "/orders"] — the SPA's noindex families are per-root-segment (e.g. /^\/orders$/ + robots prefix "Disallow: /orders"), so classification tests the path AND its ancestor prefixes. */
function ancestors(p: string): string[] {
  const out = [p];
  let idx = p.lastIndexOf("/");
  while (idx > 0) {
    out.push(p.slice(0, idx));
    idx = p.lastIndexOf("/", idx - 1);
  }
  return out;
}

/** Does the SPA classify this concrete path (or any of its ancestor prefixes) as noindex? */
function spaClassifiesPrivate(p: string): boolean {
  return ancestors(p).some((a) => NOINDEX_REGEXES.some((re) => re.test(a)));
}

// ── r140-m: sitemap body parsing helpers ────────────────────────────────────

function sitemapEntries(text: string): string[] {
  return text
    .split("<url>")
    .slice(1)
    .map((chunk) => chunk.split("</url>")[0] ?? "");
}

function entryFor(entries: string[], path: string): string | null {
  return entries.find((e) => e.includes(`<loc>${TEST_ORIGIN}${path}</loc>`)) ?? null;
}

function lastmodOf(entries: string[], path: string): string | null {
  const entry = entryFor(entries, path);
  if (!entry) return null;
  const m = entry.match(/<lastmod>([^<]+)<\/lastmod>/);
  return m ? (m[1] as string) : null;
}

describe("GET /robots.txt (R118-A5 #16)", () => {
  it("serves the allow-list + the R163 noindex-readable design with the right content type", async () => {
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
        "Allow: /flash-sales",
        "Allow: /support",
        "Allow: /terms",
      ]) {
        expect(res.text).toContain(`\n${allow}\n`);
      }

      // R163: the de-indexed customer families (auth, funnels,
      // user-private) are CRAWLABLE BY DESIGN — each serves noindex,
      // follow in the raw shell (SHELL_NOINDEX_RES) and at runtime
      // (NOINDEX_ROUTES), and Google can only read that directive when
      // the URL is not robots-blocked. The old Disallow walls are
      // pinned ABSENT so this inversion can never silently regress.
      for (const retired of [
        "Disallow: /login",
        "Disallow: /register",
        "Disallow: /forgot-password",
        "Disallow: /onboarding",
        "Disallow: /auth/",
        "Disallow: /cart",
        "Disallow: /checkout",
        "Disallow: /wallet",
        "Disallow: /orders",
        "Disallow: /loyalty",
        "Disallow: /referrals",
        "Disallow: /profile",
        "Disallow: /notifications",
      ]) {
        expect(res.text).not.toContain(`\n${retired}\n`);
      }

      // Never crawled, by documented requirement: the JSON API surface
      // (not HTML, pure crawl waste) + internal admin/observability
      // tooling (real auth fronts both).
      for (const disallow of [
        "Disallow: /api/",
        "Disallow: /admin",
        "Disallow: /admin/",
        "Disallow: /status",
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
      // Slug-less row: R166 (F6) honest omission — the old `product-<id>`
      // fallback minted a URL the shell layer itself would 404 ("product-5"
      // is not digit-only → slug lookup → miss), worse than omitting it.
      expect(res.text).not.toMatch(new RegExp(`<loc>${TEST_ORIGIN}/product/product-\\d+</loc>`));

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

      // R163: the hreflang/x-default alternates are GONE — the site is
      // single-language Arabic with no alternate versions, and hreflang
      // exists to map GENUINE alternates (Google: every documented
      // scenario requires ≥2 versions). The old same-URL ar+x-default
      // pair was redundant noise; pin its absence so it never returns.
      expect(res.text).not.toContain("hreflang");
      expect(res.text).not.toContain("xhtml:link");
      expect(res.text).not.toContain("xmlns:xhtml");
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
      // r140-m: /category/vpn tracks its OWN category's rows — the
      // fixture row must live in vpn for that entry to carry a lastmod.
      category: "vpn",
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

// ── r140-m: per-category lastmod honesty ─────────────────────────────────────

describe("GET /sitemap.xml (r140-m per-category lastmod)", () => {
  it("each /category/<slug> carries its OWN category's MAX(updated_at); home + /flash-sales keep the global", async () => {
    const vpnOld = new Date("2026-02-01T10:00:00.000Z");
    const vpnNew = new Date("2026-08-15T12:00:00.000Z");
    const musicNew = new Date("2026-03-10T09:30:00.000Z");
    const archivedFuture = new Date("2027-01-01T00:00:00.000Z");
    await db.insert(productsTable).values([
      {
        name: "VPN Old",
        slug: "vpn-old",
        price: "10.00",
        category: "vpn",
        isActive: true,
        isArchived: false,
        updatedAt: vpnOld,
      },
      {
        name: "VPN New",
        slug: "vpn-new",
        price: "10.00",
        category: "vpn",
        isActive: true,
        isArchived: false,
        updatedAt: vpnNew,
      },
      {
        name: "Music New",
        slug: "music-new",
        price: "10.00",
        category: "music",
        isActive: true,
        isArchived: false,
        updatedAt: musicNew,
      },
      // Archived rows must NEVER freshen a landing page they no longer
      // appear on (neither vpn's nor the global MAX).
      {
        name: "VPN Dead",
        slug: "vpn-dead",
        price: "10.00",
        category: "vpn",
        isActive: true,
        isArchived: true,
        updatedAt: archivedFuture,
      },
    ]);

    const { url, close } = await listen(buildApp());
    try {
      const res = await getBody(url, "/sitemap.xml");
      expect(res.status).toBe(200);
      const entries = sitemapEntries(res.text);

      // Per-category MAX — vpn's own newest row, not the global stamp,
      // not the archived row, not music's row.
      expect(lastmodOf(entries, "/category/vpn")).toBe(vpnNew.toISOString());
      expect(lastmodOf(entries, "/category/music")).toBe(musicNew.toISOString());
      // The two DIVERGE — a VPN edit must not advertise /category/music.
      expect(lastmodOf(entries, "/category/vpn")).not.toBe(lastmodOf(entries, "/category/music"));

      // Home + /flash-sales render the ENTIRE active catalog → the
      // global MAX (vpnNew is the newest live row).
      expect(lastmodOf(entries, "/")).toBe(vpnNew.toISOString());
      expect(lastmodOf(entries, "/flash-sales")).toBe(vpnNew.toISOString());

      // A live category with ZERO products omits lastmod entirely —
      // the R122 "honest unknown" rule (a borrowed timestamp would be
      // exactly the noisy-lastmod trap that policy retired).
      for (const empty of ["/category/software", "/category/streaming"]) {
        expect(entryFor(entries, empty)).not.toContain("<lastmod>");
      }
    } finally {
      close();
    }
  });
});

// ── r140-m: sitemap static-set parity with the frontend registries ──────────

describe("GET /sitemap.xml (r140-m route parity)", () => {
  it("the static URL set is EXACTLY the SPA's indexable static routes + the live CATEGORY_META slugs", async () => {
    await db.insert(productsTable).values({
      name: "Parity Product",
      slug: "parity-product",
      price: "10.00",
      category: "vpn",
      isActive: true,
      isArchived: false,
    });

    const { url, close } = await listen(buildApp());
    try {
      const res = await getBody(url, "/sitemap.xml");
      expect(res.status).toBe(200);

      const locs = [...res.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1] as string);
      const staticPaths = locs
        .filter((l) => !l.startsWith(`${TEST_ORIGIN}/product/`))
        .map((l) => l.slice(TEST_ORIGIN.length));

      // Frontend sources of truth, parsed live:
      //  • categories.ts CATEGORY_META — the documented SSOT for the
      //    backend sitemap's category set (its own docblock says so);
      //  • routes.tsx static indexable routes — concrete paths (no
      //    :params, no splats) that the SPA's own NOINDEX_ROUTES does
      //    NOT classify private, minus the /products alias redirect.
      const frontendCategorySlugs = [...CATEGORIES_TS.matchAll(/^ {2}("?)([a-z-]+)\1: \{$/gm)].map(
        (m) => m[2] as string,
      );
      expect([...frontendCategorySlugs].sort()).toEqual([
        "ai-tools",
        "education",
        "music",
        "seo-tools",
        "software",
        "streaming",
        "vpn",
      ]);

      const staticIndexable = SPA_PATHS.filter(
        (p) =>
          !p.includes(":") && !p.includes("*") && p !== "/products" && !spaClassifiesPrivate(p),
      );
      // Extraction sanity: the four storefront money/marketing surfaces.
      expect([...staticIndexable].sort()).toEqual(["/", "/flash-sales", "/support", "/terms"]);

      const expected = [
        ...new Set([...staticIndexable, ...frontendCategorySlugs.map((s) => `/category/${s}`)]),
      ].sort();
      expect([...staticPaths].sort()).toEqual(expected);

      // The dynamic /product/:slug family IS enumerated (the money
      // surface) — the fixture row proves it non-vacuously.
      expect(locs).toContain(`${TEST_ORIGIN}/product/parity-product`);

      // Deliberate absences, pinned: the R128 A2-F3 alias redirect
      // (/products → / — listing both would be a duplicate-URL signal
      // against the canonical) and the retired categories (noindex
      // not-found until restocked).
      expect(staticPaths).not.toContain("/products");
      expect(staticPaths).not.toContain("/category/gaming");
      expect(staticPaths).not.toContain("/category/productivity");
    } finally {
      close();
    }
  });
});

// ── r140-m: robots walls frozen + SPA classification parity ──────────────────

describe("GET /robots.txt (r140-m walls + SPA parity)", () => {
  it("the Allow/Disallow walls are FROZEN as the exact line set (any edit must consciously re-pin)", async () => {
    const { url, close } = await listen(buildApp());
    try {
      const res = await getBody(url, "/robots.txt");
      expect(res.status).toBe(200);
      const lines = res.text.split("\n").filter((l) => /^(Allow|Disallow): /.test(l));
      expect(lines).toEqual([
        // Public crawlable surface.
        "Allow: /",
        "Allow: /product/",
        "Allow: /category/",
        "Allow: /flash-sales",
        "Allow: /support",
        "Allow: /terms",
        // R163: the noindex-dependent customer families (auth, cart/
        // checkout, user-private) are deliberately CRAWLABLE — their
        // noindex,follow shell must stay readable to crawlers; the old
        // Disallow walls were removed in this round (see seo.ts).
        // Never crawled, by documented requirement:
        "Disallow: /api/",
        "Disallow: /admin",
        "Disallow: /admin/",
        "Disallow: /status",
      ]);
    } finally {
      close();
    }
  });

  it("every noindex-classified route the SPA mounts stays CRAWLABLE (the noindex directive must remain readable); the documented walls hold; indexable routes stay crawlable", async () => {
    // R163 INVERSION of the r140-m pin: the SPA's privacy classification
    // (route-shapes.ts NOINDEX_ROUTES) marks these routes noindex — and a
    // noindex directive is only effective when Google can FETCH the page.
    // robots-blocking a noindex page creates the "Indexed, though
    // blocked by robots.txt" state instead of a clean drop. The
    // exceptions are the three DOCUMENTED walls (/admin, /status —
    // internal tooling behind real authentication, not customer
    // surfaces; /api/ never appears in the SPA registry). A stray
    // Disallow on an indexable money page is still a failure — that
    // direction of the pin is unchanged.
    const { url, close } = await listen(buildApp());
    try {
      const res = await getBody(url, "/robots.txt");
      expect(res.status).toBe(200);

      const rules = res.text
        .split("\n")
        .filter((l) => /^(Allow|Disallow): /.test(l))
        .map((l) => ({
          disallow: l.startsWith("Disallow"),
          value: l.slice(l.indexOf(": ") + 2),
        }));

      // Google robots semantics: the longest matching prefix wins; a
      // tie goes to Allow. "Allow: /" always matches, so the default
      // is crawlable.
      const blocked = (p: string): boolean => {
        let bestLen = 0;
        let isBlocked = false;
        for (const r of rules) {
          if (!p.startsWith(r.value)) continue;
          if (r.value.length > bestLen || (r.value.length === bestLen && !r.disallow)) {
            bestLen = r.value.length;
            isBlocked = r.disallow;
          }
        }
        return isBlocked;
      };

      // Extraction sanity — the registry parse found the real Switch.
      expect(SPA_PATHS.length).toBeGreaterThan(20);
      expect(SPA_PATHS).toContain("/");
      expect(SPA_PATHS).toContain("/notifications");
      expect(SPA_PATHS).toContain("/product/:slug");
      expect(SPA_PATHS).toContain("/category/:slug");

      for (const raw of SPA_PATHS) {
        // :param segments and * splats → representative concrete paths.
        const p = raw.replace(/:[^/]+/g, "x").replace(/\*/g, "nested");
        if (spaClassifiesPrivate(p)) {
          const documentedWall = p === "/admin" || p.startsWith("/admin/") || p === "/status";
          if (documentedWall) {
            expect(blocked(p), `the documented internal wall must hold for ${raw}`).toBe(true);
          } else {
            expect(
              blocked(p),
              `robots must NOT block the SPA's noindex route ${raw} — the noindex,follow directive must stay readable to crawlers`,
            ).toBe(false);
          }
        } else {
          expect(blocked(p), `robots must NOT block the SPA's indexable route ${raw}`).toBe(false);
        }
      }
    } finally {
      close();
    }
  });
});
