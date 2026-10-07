import { db, productsTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { logger } from "../lib/logger";

const router: IRouter = Router();

/**
 * Authoritative production SEO origin.
 *
 * Resolved ONCE at module load from `APP_URL`. We strip any trailing slash
 * so concatenations like `${APP_ORIGIN}/foo` never produce `//foo`. If the
 * env is unset we fall back to the canonical production origin — never to
 * the legacy onrender hostname or to a localhost URL, since this module is
 * SEO-critical and a wrong origin in prod means Google indexes the wrong
 * canonical.
 */
const APP_ORIGIN = (process.env.APP_URL || "https://subnation.ly").replace(/\/$/, "");

// ────────────────────────────────────────────────────────────────────────────
// /robots.txt
// ────────────────────────────────────────────────────────────────────────────
//
// Disallow list covers EVERY non-public route the SPA exposes:
//
//   • Auth flow                    /login, /register, /forgot-password,
//                                    /onboarding, /auth/, /auth/callback
//   • User-private pages           /wallet, /orders, /loyalty, /referrals,
//                                    /profile  (these render user-state-
//                                    dependent content that's empty for an
//                                    anonymous crawler — bad for SEO)
//   • Admin                        /admin, /admin/*
//   • Internal observability       /status   (operational view; no
//                                    customer-facing value)
//   • API surface                  /api/
//
// Public crawlable routes (allowed):
//   • /                            home / catalog
//   • /product/:id                 individual product pages (anonymous-
//                                    renderable; the catalog data is public)
//   • /support                     help center (mostly static)
//   • /terms                       legal
//
// Sitemap reference points at the dynamic /sitemap.xml below (not a static
// file). Cache-Control max-age=300 so crawlers revisit hourly-ish without
// hammering the origin.

const ROBOTS_BODY = [
  "# subnation.ly — robots.txt",
  "# Authoritative source: backend/src/routes/seo.ts",
  "",
  "User-agent: *",
  "",
  "# Public crawlable surface",
  "Allow: /",
  "Allow: /product/",
  "Allow: /category/",
  "Allow: /support",
  "Allow: /terms",
  "",
  "# Auth flow — never index",
  "Disallow: /login",
  "Disallow: /register",
  "Disallow: /forgot-password",
  "Disallow: /onboarding",
  "Disallow: /auth/",
  "",
  "# Cart + checkout — transactional funnels, never index (V3-A2)",
  "Disallow: /cart",
  "Disallow: /checkout",
  "",
  "# User-private pages (anonymous crawlers see redirects / empty state)",
  "Disallow: /wallet",
  "Disallow: /orders",
  "Disallow: /loyalty",
  "Disallow: /referrals",
  "Disallow: /profile",
  "",
  "# Admin + internal observability",
  "Disallow: /admin",
  "Disallow: /admin/",
  "Disallow: /status",
  "",
  "# API surface",
  "Disallow: /api/",
  "",
  // Crawl-delay is a soft hint; modern Googlebot/Bingbot ignore it but other
  // crawlers (Yandex, Baidu) honour it. 1s gives small crawlers air without
  // affecting SEO speed.
  "Crawl-delay: 1",
  "",
  `Sitemap: ${APP_ORIGIN}/sitemap.xml`,
  "",
].join("\n");

router.get("/robots.txt", (_req, res) => {
  res.set("Content-Type", "text/plain; charset=utf-8");
  res.set("Cache-Control", "public, max-age=300, stale-while-revalidate=600");
  res.send(ROBOTS_BODY);
});

// ────────────────────────────────────────────────────────────────────────────
// /sitemap.xml
// ────────────────────────────────────────────────────────────────────────────
//
// Public, anonymous-renderable, SEO-relevant routes ONLY. User-state-
// dependent routes (/loyalty, /referrals, /profile, /wallet, /orders) are
// EXCLUDED — Googlebot doesn't sign in, so those URLs would be indexed as
// empty pages, diluting the index.
//
// In-memory cache (60 s) avoids hammering Postgres on every crawler hit.
// `bumpSitemapCache()` is called by admin product CRUD so the next request
// after a product change rebuilds.

interface SitemapCacheEntry {
  body: string;
  builtAt: number;
}

const SITEMAP_TTL_MS = 60_000;
const SITEMAP_MAX_URLS = 50_000; // sitemap.org spec cap per file
let sitemapCache: SitemapCacheEntry | null = null;

/**
 * R122 (A7-P2): per-route lastmod policy. Every static entry used to
 * share MAX(product.updated_at) — a catalog proxy that is legitimate
 * ONLY for routes that RENDER the catalog (homepage, category landings,
 * flash-sales: when products change, those pages genuinely changed).
 * /terms (yearly) and /support (monthly) churned a "fresh" lastmod on
 * every product edit with zero content change — noisy lastmod is the
 * fastest way to teach Google to ignore the field site-wide. Those
 * editorial pages now OMIT lastmod entirely (honest "unknown" beats a
 * lie; sitemap.org makes the tag optional) until they gain a real
 * content-timestamp source.
 */
interface StaticRoute {
  path: string;
  changefreq: string;
  priority: string;
  /** "catalog" = the catalog-driven global lastmod; "none" = omit the tag. */
  lastmod: "catalog" | "none";
}

const STATIC_ROUTES: StaticRoute[] = [
  { path: "/", changefreq: "daily", priority: "1.0", lastmod: "catalog" },
  // Category landing pages — each targets a distinct intent cluster
  // (the seven live categories mirroring products.category in
  // production) with unique h1, intro, and FAQs. Higher priority
  // than /support + /terms because they're money pages with money
  // intent. Retired gaming/productivity pages are intentionally
  // absent: they render a noindex surface until restocked.
  { path: "/category/streaming", changefreq: "weekly", priority: "0.9", lastmod: "catalog" },
  { path: "/category/music", changefreq: "weekly", priority: "0.9", lastmod: "catalog" },
  { path: "/category/software", changefreq: "weekly", priority: "0.9", lastmod: "catalog" },
  { path: "/category/vpn", changefreq: "weekly", priority: "0.9", lastmod: "catalog" },
  { path: "/category/ai-tools", changefreq: "weekly", priority: "0.9", lastmod: "catalog" },
  { path: "/category/seo-tools", changefreq: "weekly", priority: "0.9", lastmod: "catalog" },
  { path: "/category/education", changefreq: "weekly", priority: "0.9", lastmod: "catalog" },
  { path: "/support", changefreq: "monthly", priority: "0.4", lastmod: "none" },
  { path: "/terms", changefreq: "yearly", priority: "0.3", lastmod: "none" },
  // V3-A4: money page missing from the sitemap — index,follow but
  // never listed for discovery. Renders the live on-sale catalog →
  // keeps the catalog-driven lastmod.
  { path: "/flash-sales", changefreq: "daily", priority: "0.8", lastmod: "catalog" },
];

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function urlEntry(
  loc: string,
  // R122 (A7-P2): lastmod is now OPTIONAL — editorial static routes
  // (terms/support) omit it (see STATIC_ROUTES below); product +
  // catalog-driven entries keep their real timestamps.
  lastmod: string | null,
  changefreq: string,
  priority: string,
): string {
  const escapedLoc = escapeXml(loc);
  return [
    "  <url>",
    `    <loc>${escapedLoc}</loc>`,
    ...(lastmod ? [`    <lastmod>${lastmod}</lastmod>`] : []),
    `    <changefreq>${changefreq}</changefreq>`,
    `    <priority>${priority}</priority>`,
    // The site is currently Arabic-only. We declare the Arabic alternate
    // for explicit-locale crawlers, plus x-default for fallback. We do
    // NOT emit an "en" alternate because no English version exists; an
    // alternate that points to Arabic content is a misconfiguration that
    // Google can flag and use to suppress the entire alternate set.
    `    <xhtml:link rel="alternate" hreflang="ar" href="${escapedLoc}" />`,
    `    <xhtml:link rel="alternate" hreflang="x-default" href="${escapedLoc}" />`,
    "  </url>",
  ].join("\n");
}

async function buildSitemap(): Promise<string> {
  // Catalog-driven lastmod (R122 A7-P2: now consumed ONLY by the routes
  // whose rendered content IS the catalog — see STATIC_ROUTES).
  const [{ maxUpdated }] = await db
    .select({ maxUpdated: sql<string | null>`MAX(${productsTable.updatedAt})` })
    .from(productsTable)
    .where(and(eq(productsTable.isActive, true), eq(productsTable.isArchived, false)));

  const fallbackLastmod = new Date().toISOString();
  const globalLastmod = maxUpdated ? new Date(maxUpdated).toISOString() : fallbackLastmod;

  const products = await db
    .select({
      id: productsTable.id,
      slug: productsTable.slug,
      updatedAt: productsTable.updatedAt,
    })
    .from(productsTable)
    .where(and(eq(productsTable.isActive, true), eq(productsTable.isArchived, false)))
    .limit(SITEMAP_MAX_URLS - STATIC_ROUTES.length);

  const staticEntries = STATIC_ROUTES.map((r) =>
    urlEntry(
      `${APP_ORIGIN}${r.path}`,
      r.lastmod === "catalog" ? globalLastmod : null,
      r.changefreq,
      r.priority,
    ),
  );

  const productEntries = products.map((p) =>
    urlEntry(
      // Prefer slug over id for SEO crawlability. Defensive fallback to
      // `product-<id>` for any (impossible-post-migration) row whose
      // slug is null — keeps the sitemap valid.
      `${APP_ORIGIN}/product/${p.slug ?? `product-${p.id}`}`,
      (p.updatedAt instanceof Date ? p.updatedAt : new Date()).toISOString(),
      "weekly",
      "0.8",
    ),
  );

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...staticEntries,
    ...productEntries,
    "</urlset>",
    "",
  ].join("\n");
}

router.get("/sitemap.xml", async (_req, res) => {
  try {
    const now = Date.now();
    if (!sitemapCache || now - sitemapCache.builtAt > SITEMAP_TTL_MS) {
      const body = await buildSitemap();
      sitemapCache = { body, builtAt: now };
    }
    res.set("Content-Type", "application/xml; charset=utf-8");
    res.set("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    res.send(sitemapCache.body);
  } catch (err) {
    logger.error({ err, category: "seo" }, "sitemap build failed");
    res.status(500).set("Content-Type", "text/plain").send("sitemap_unavailable");
  }
});

/**
 * Invalidate the in-memory sitemap cache. Admin product create / update /
 * delete handlers call this so the next /sitemap.xml request rebuilds and
 * reflects the latest product set.
 */
export function bumpSitemapCache(): void {
  sitemapCache = null;
}

export default router;
