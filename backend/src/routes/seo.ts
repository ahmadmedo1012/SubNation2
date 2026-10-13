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
// Disallow list covers EVERY non-public route the SPA exposes
// (r140-m parity audit against frontend/src/app/routes.tsx):
//
//   • Auth flow                    /login, /register, /forgot-password,
//                                    /onboarding, /auth/, /auth/callback
//   • Cart + checkout funnels      /cart, /checkout (V3-A2)
//   • User-private pages           /wallet, /orders (+ detail urls), /loyalty,
//                                    /referrals, /profile, /notifications
//                                    (these render user-state-dependent
//                                    content that's empty for an anonymous
//                                    crawler — bad for SEO)
//   • Admin                        /admin, /admin/*
//   • Internal observability       /status   (operational view; no
//                                    customer-facing value)
//   • API surface                  /api/
//
// Public crawlable routes (allowed):
//   • /                            home / catalog
//   • /product/<slug>              individual product pages (anonymous-
//                                    renderable; the catalog data is public)
//   • /category/<slug>             the 7 live category landings
//   • /flash-sales                 on-sale money page (V3-A4)
//   • /support                     help center (mostly static)
//   • /terms                       legal
//
// r140-m notes:
//   • /notifications gained its Disallow row here — the page shipped in
//     R128-IMP-5 (A9-F2) and the SPA's own noindex mirror
//     (frontend/src/app/route-shapes.ts NOINDEX_ROUTES) had flagged the
//     missing wall since then.
//   • /forgot-password is a RETIRED route (no entry in the SPA's route
//     registry since the auth flow was consolidated; the URL 404s in the
//     client router). The wall is kept deliberately: the noindex mirrors
//     (route-shapes.ts NOINDEX_ROUTES + spa-shell.ts SHELL_NOINDEX_RES)
//     still list the family, a Disallow on a dead path costs nothing, and
//     it guards an accidental re-introduction. Removing it here would
//     diverge the three walls for zero SEO gain.
//   • /flash-sales gained its explicit Allow line — it was always
//     crawlable via the blanket "Allow: /" (nothing disallowed it), but
//     the documented public-surface list above now names every money
//     page the sitemap advertises.
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
  "Allow: /flash-sales",
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
  // R128-IMP-5 shipped the page; r140-m ships the wall it asked for.
  "Disallow: /notifications",
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
 *
 * r140-m (lane parity/lastmod honesty): the category landings no longer
 * share the GLOBAL catalog MAX — each /category/<slug> entry carries
 * MAX(updated_at) of THAT category's rows only. The live sitemap's
 * all-categories-one-timestamp shape was a bulk-import DATA artifact
 * (every row's updated_at sits in one 20 s window), but the builder
 * still re-stamped all 7 categories whenever ANY product changed — a
 * VPN edit would advertise /category/music as modified. Per-category
 * MAX fixes that with data the catalog already owns
 * (products.category + products.updated_at). Home and /flash-sales keep
 * the global MAX: they render the ENTIRE active catalog (flash-sales
 * filters the whole list client-side over the site-wide singleton
 * sale), so any product change genuinely changes them. A category with
 * zero live products omits lastmod (the R122 "honest unknown" rule).
 */
interface StaticRoute {
  path: string;
  changefreq: string;
  priority: string;
  /**
   * "catalog" = the global MAX(updated_at) (routes rendering the whole
   *   catalog); "category" = MAX(updated_at) of that category's own rows
   *   (path must be /category/<slug>); "none" = omit the tag.
   */
  lastmod: "catalog" | "category" | "none";
}

const STATIC_ROUTES: StaticRoute[] = [
  { path: "/", changefreq: "daily", priority: "1.0", lastmod: "catalog" },
  // Category landing pages — each targets a distinct intent cluster
  // (the seven live categories mirroring products.category in
  // production) with unique h1, intro, and FAQs. Higher priority
  // than /support + /terms because they're money pages with money
  // intent. Retired gaming/productivity pages are intentionally
  // absent: they render a noindex surface until restocked.
  // r140-m: lastmod "category" — each entry tracks its OWN category's
  // MAX(updated_at) (see the R122/r140-m policy block above).
  { path: "/category/streaming", changefreq: "weekly", priority: "0.9", lastmod: "category" },
  { path: "/category/music", changefreq: "weekly", priority: "0.9", lastmod: "category" },
  { path: "/category/software", changefreq: "weekly", priority: "0.9", lastmod: "category" },
  { path: "/category/vpn", changefreq: "weekly", priority: "0.9", lastmod: "category" },
  { path: "/category/ai-tools", changefreq: "weekly", priority: "0.9", lastmod: "category" },
  { path: "/category/seo-tools", changefreq: "weekly", priority: "0.9", lastmod: "category" },
  { path: "/category/education", changefreq: "weekly", priority: "0.9", lastmod: "category" },
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
  // ONE grouped aggregate scan feeds BOTH lastmod tiers (r140-m):
  //   • per-category MAX(updated_at) — the /category/<slug> entries;
  //   • the global max over the same rows — home + /flash-sales (they
  //     render the whole active catalog) and the product-entry fallback
  //     shape. Archived/inactive rows are excluded, so a retired product
  // can never freshen a landing page it no longer appears on.
  const categoryRows = await db
    .select({
      category: productsTable.category,
      maxUpdated: sql<string | null>`MAX(${productsTable.updatedAt})`,
    })
    .from(productsTable)
    .where(and(eq(productsTable.isActive, true), eq(productsTable.isArchived, false)))
    .groupBy(productsTable.category);

  const fallbackLastmod = new Date().toISOString();
  // Keys are lowercased products.category values — the sitemap slugs are
  // lowercase and the category page filters with a LOWER() equality, so a
  // stray case variant still resolves instead of silently dropping the
  // entry's lastmod.
  const lastmodByCategory = new Map<string, string>();
  let globalMaxMs: number | null = null;
  for (const row of categoryRows) {
    const raw = row.maxUpdated;
    if (raw == null) continue;
    const ms = new Date(raw).getTime();
    if (Number.isNaN(ms)) continue;
    if (globalMaxMs === null || ms > globalMaxMs) globalMaxMs = ms;
    if (typeof row.category === "string" && row.category.length > 0) {
      lastmodByCategory.set(row.category.toLowerCase(), new Date(ms).toISOString());
    }
  }
  const globalLastmod =
    globalMaxMs !== null ? new Date(globalMaxMs).toISOString() : fallbackLastmod;

  const products = await db
    .select({
      id: productsTable.id,
      slug: productsTable.slug,
      updatedAt: productsTable.updatedAt,
    })
    .from(productsTable)
    .where(and(eq(productsTable.isActive, true), eq(productsTable.isArchived, false)))
    .limit(SITEMAP_MAX_URLS - STATIC_ROUTES.length);

  /** r140-m: resolve a static entry's lastmod per the R122/r140-m policy. */
  const lastmodFor = (r: StaticRoute): string | null => {
    if (r.lastmod === "none") return null;
    if (r.lastmod === "catalog") return globalLastmod;
    const slug = r.path.startsWith("/category/") ? r.path.slice("/category/".length) : null;
    // Unknown slug (or a live category with zero products) → omit the
    // tag: the honest "unknown" beats a stale or borrowed timestamp.
    return slug !== null ? (lastmodByCategory.get(slug) ?? null) : null;
  };

  const staticEntries = STATIC_ROUTES.map((r) =>
    urlEntry(`${APP_ORIGIN}${r.path}`, lastmodFor(r), r.changefreq, r.priority),
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
