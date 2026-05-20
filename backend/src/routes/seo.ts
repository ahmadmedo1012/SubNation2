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

const STATIC_ROUTES: Array<{ path: string; changefreq: string; priority: string }> = [
  { path: "/", changefreq: "daily", priority: "1.0" },
  { path: "/support", changefreq: "monthly", priority: "0.4" },
  { path: "/terms", changefreq: "yearly", priority: "0.3" },
];

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function urlEntry(loc: string, lastmod: string, changefreq: string, priority: string): string {
  const escapedLoc = escapeXml(loc);
  return [
    "  <url>",
    `    <loc>${escapedLoc}</loc>`,
    `    <lastmod>${lastmod}</lastmod>`,
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
  // Static-route lastmod uses MAX(updatedAt) of active products as a loose
  // proxy: when products change, the catalog (homepage) effectively did too.
  const [{ maxUpdated }] = await db
    .select({ maxUpdated: sql<string | null>`MAX(${productsTable.updatedAt})` })
    .from(productsTable)
    .where(and(eq(productsTable.isActive, true), eq(productsTable.isArchived, false)));

  const fallbackLastmod = new Date().toISOString();
  const globalLastmod = maxUpdated ? new Date(maxUpdated).toISOString() : fallbackLastmod;

  const products = await db
    .select({
      id: productsTable.id,
      updatedAt: productsTable.updatedAt,
    })
    .from(productsTable)
    .where(and(eq(productsTable.isActive, true), eq(productsTable.isArchived, false)))
    .limit(SITEMAP_MAX_URLS - STATIC_ROUTES.length);

  const staticEntries = STATIC_ROUTES.map((r) =>
    urlEntry(`${APP_ORIGIN}${r.path}`, globalLastmod, r.changefreq, r.priority),
  );

  const productEntries = products.map((p) =>
    urlEntry(
      `${APP_ORIGIN}/product/${p.id}`,
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
