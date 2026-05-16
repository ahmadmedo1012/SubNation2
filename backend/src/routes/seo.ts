import { db, productsTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const APP_ORIGIN = (process.env.APP_URL || "https://subnation2.onrender.com").replace(/\/$/, "");

// ── robots.txt (static) ──────────────────────────────────────────────────────

const ROBOTS_BODY = [
  "User-agent: *",
  "Allow: /",
  "Disallow: /admin/",
  "Disallow: /api/",
  "",
  `Sitemap: ${APP_ORIGIN}/sitemap.xml`,
  "",
].join("\n");

router.get("/robots.txt", (_req, res) => {
  res.set("Content-Type", "text/plain; charset=utf-8");
  res.set("Cache-Control", "public, max-age=300");
  res.send(ROBOTS_BODY);
});

// ── sitemap.xml (dynamic, cached) ────────────────────────────────────────────

interface SitemapCacheEntry {
  body: string;
  builtAt: number;
}

const SITEMAP_TTL_MS = 60_000;
let sitemapCache: SitemapCacheEntry | null = null;

/**
 * Static (non-product) public routes. Each entry produces one <url> with
 * Arabic + English `xhtml:link rel="alternate" hreflang=…` siblings.
 */
const STATIC_ROUTES: Array<{ path: string; changefreq: string; priority: string }> = [
  { path: "/", changefreq: "daily", priority: "1.0" },
  { path: "/loyalty", changefreq: "weekly", priority: "0.6" },
  { path: "/referrals", changefreq: "weekly", priority: "0.6" },
  { path: "/support", changefreq: "monthly", priority: "0.5" },
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
    `    <xhtml:link rel="alternate" hreflang="ar" href="${escapedLoc}" />`,
    `    <xhtml:link rel="alternate" hreflang="en" href="${escapedLoc}" />`,
    `    <xhtml:link rel="alternate" hreflang="x-default" href="${escapedLoc}" />`,
    "  </url>",
  ].join("\n");
}

async function buildSitemap(): Promise<string> {
  // Static routes use the most recent product update as a loose lastmod proxy.
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
    .limit(50_000); // sitemap.org limit is 50k urls per file

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
    res.set("Cache-Control", "public, max-age=60");
    res.send(sitemapCache.body);
  } catch (err) {
    logger.error({ err }, "sitemap build failed");
    res.status(500).set("Content-Type", "text/plain").send("sitemap_unavailable");
  }
});

/**
 * Invalidate the in-memory sitemap cache. Product create / update / delete
 * handlers should call this so the next sitemap.xml request rebuilds.
 */
export function bumpSitemapCache(): void {
  sitemapCache = null;
}

export default router;
