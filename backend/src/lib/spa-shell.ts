import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { db, inventoryTable, productsTable } from "@workspace/db";
import { logger } from "./logger";
// R122 (A3-P1): the /product/:slug shell + share-card lookups ride the
// catalog cache (60 s TTL, generation-bumped by admin CRUD) — they are
// unauthenticated, outside every rate limiter, and were the one route
// family hitting Postgres per request.
import { withCatalogCache } from "./catalog-cache";
import { applyFlashSale } from "./pricing";
import { formatLydNumber } from "./money";
// R163: the deliverable-stock predicate the public catalog's is_available
// rides (services/catalog.service.ts) — imported so the shell's JSON-LD
// Offer asserts availability from the SAME stock semantics as the API.
import { deliverableUnitCondition } from "../services/catalog.service";
// R163: the IndexNow key-file route mounts here (the shell layer owns
// root-level non-API GET routing) — fully env-gated.
import { indexNowKey } from "./indexnow";
// R163 size-gate carve: the static meta constants + the Product-LD
// builders live in their own modules (this file is growth-banned at
// 1,039 lines); re-exported below so every existing consumer (app.ts
// re-exports + the parity suites) keeps its import path.
import { SHELL_CATEGORY_META, SHELL_HOME_META, SHELL_STATIC_ROUTE_META } from "./shell-meta";
import { buildShellProductLd, injectJsonLdScript } from "./shell-product-ld";
export { SHELL_CATEGORY_META, SHELL_HOME_META, SHELL_STATIC_ROUTE_META } from "./shell-meta";
import type { Express, NextFunction, Request, Response } from "express";
import express from "express";

/**
 * R136 (app.ts decomposition): the entire SPA-shell/SEO layer moved here
 * VERBATIM from app.ts (:947-1768 + :1851-1897) — the shell snapshot, the
 * meta constants, the rewrite helpers, the static mounts with their cache
 * headers, the OG-card unfurler middleware and the SPA fallback. app.ts
 * calls mountSpaShellRoutes(app) at the SAME position in the middleware
 * order and re-exports the test-facing names, so every
 * src/__tests__/spa-*.test.ts + share-card-bot-split.test.ts keeps
 * working unedited (the R135 shim contract).
 *
 * The one intentional change: R136 PERF #10 — applySpaShellMeta now
 * memoizes its output (bounded LRU, see the cache block below). The pure
 * rewriter underneath is byte-identical to the previous implementation.
 */

function resolveFrontendDist(): string | null {
  const candidates = [
    process.env.FRONTEND_DIST,
    path.resolve(process.cwd(), "../frontend/dist/public"),
    path.resolve(process.cwd(), "frontend/dist/public"),
  ].filter((candidate): candidate is string => Boolean(candidate));

  return candidates.find((candidate) => existsSync(path.join(candidate, "index.html"))) ?? null;
}

const frontendDist = resolveFrontendDist();

// ── R120-B3 (A7-F3 / A7-F7 / A7-F16): per-route static-shell SEO meta ──────
//
// The SPA fallback below used to send the SAME index.html for every
// route — so the shell's hard-coded `<link rel=canonical
// href="https://subnation.ly/">` told every no-JS crawler (and every
// indexer that reads the raw HTML before rendering) that /category/vpn,
// /product/x, /login… were all duplicates of the HOMEPAGE. Three audit
// findings ride this one shell-rewrite layer:
//
//   A7-F3 (P1): known public routes get their REAL canonical + title +
//               description rewritten into the shell before sending —
//               category pages from the map below, products from the
//               same DB row the share card uses, statics for
//               /flash-sales, /terms, /support.
//   A7-F7 (P2): /product/:slug that misses the DB (unknown / inactive /
//               archived row) now answers 404 — the shell still ships
//               so the SPA's client-side not-found page renders, but
//               crawlers no longer see a 200 "soft 404".
//   A7-F16(P3): auth/transactional/admin families get `noindex,follow`
//               stamped into the static robots meta (mirroring the
//               SPA's NOINDEX_ROUTES + robots.txt Disallow list) and
//               the homepage canonical is STRIPPED (a canonical aiming
//               a noindex page at the homepage is a contradiction).
//   R122 (A7-P1-1): the product shell now prefers the row's DB-backed
//               seo_title / seo_description (operator overrides, the
//               SAME fields the hydrated page renders) over the
//               English brand-only `${name} — SubNation` fallback —
//               raw-HTML and post-render titles finally agree on the
//               45 money pages.
//   R122 (A7-P1-2): unknown public paths and unknown category slugs
//               ALSO get `noindex,follow` — the SPA renders its own
//               noindex 404 surface for exactly these URLs, and the
//               raw shell used to contradict it with index,follow.
//   R122 (A3-P1): the /product/:slug DB lookup behind this layer (and
//               the share card's) is unauthenticated and sits outside
//               every rate limiter — it now rides the catalog cache
//               idiom (60 s TTL, generation-bumped by admin CRUD).
//
// Unknown paths: the homepage canonical is stripped (NO canonical
// beats a lying one) and the robots meta is stamped `noindex,follow`
// (R122 A7-P1-2 — mirrors the SPA's own 404 treatment); the shell stays
// 200 so the SPA's client-side 404 owns the UX.
//
// Safety posture: the shell is read ONCE at boot into memory and every
// rewrite is a pure string op on that snapshot (streaming-safe, and the
// immutable-asset/CSP headers above are untouched — this layer only
// rewrites the HTML document body). Only EXISTING tags are rewritten,
// never inserted, so a stub/test shell without the markers passes
// through byte-identical.
//
// R122 (A7-P2): boot-time comment-balance guard. rewriteOutsideComments
// splits on CLOSED comments only — an unclosed `<!--` in a future shell
// edit turns the whole tail into one "non-comment" segment and the
// title rewriter pairs the COMMENT's `<title>` prose with the real
// closer (the d22f24e incident class: canonical + every og tag deleted
// from /category/* shells, silently). An imbalanced shell now refuses to
// enter the rewrite layer AT ALL (fatal boot log + SPA_SHELL_HTML=null
// → the fallback below serves the UNTOUCHED file) — the site boots with
// baseline meta instead of shipping destructive rewrites.
const SPA_SHELL_HTML = (() => {
  if (!frontendDist) return null;
  try {
    const html = readFileSync(path.join(frontendDist, "index.html"), "utf8");
    // R122 (A7-P2): the d22f24e guard — see the block comment above.
    // Degrade (null) instead of throwing: the API/money surface must
    // survive a cosmetic shell defect; the fatal log + the pinned
    // regression test are the loud half of the contract.
    if (!shellCommentsBalance(html)) {
      const opens = (html.match(/<!--/g) ?? []).length;
      const closes = (html.match(/-->/g) ?? []).length;
      logger.fatal(
        { category: "seo", opens, closes },
        "SPA shell HTML comments are UNBALANCED (<!-- vs -->) — the d22f24e " +
          "rewrite bug class. Serving the UNREWRITTEN shell (baseline meta) " +
          "until the template is fixed; refusing to run the shell rewriter.",
      );
      return null;
    }
    return html;
  } catch {
    return null;
  }
})();

/**
 * R122 (A7-P2): true when the shell's HTML comment delimiters balance.
 * Exported for the regression tests (unit cases + the real shipped
 * frontend/index.html pin). A mismatch means rewriteOutsideComments'
 * split-on-closed-comments would treat comment prose as markup — the
 * d22f24e incident class (see SPA_SHELL_HTML above).
 */
export function shellCommentsBalance(html: string): boolean {
  return (html.match(/<!--/g) ?? []).length === (html.match(/-->/g) ?? []).length;
}

/** Authoritative public origin — the SAME resolution routes/seo.ts and
 * the share card use (APP_URL with the canonical production default). */
function appOrigin(): string {
  return (process.env.APP_URL || "https://subnation.ly").replace(/\/$/, "");
}

/** HTML-escape for text/attribute contexts (title bodies, meta content). */
function escapeHtmlAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * R120-B3 (A7-F9): the price a share card / shell meta should advertise
 * — the ACTIVE flash-sale price (via lib/pricing.ts, the single source
 * the catalog + checkout apply) when one is live and lower than the
 * list price; the list price otherwise. Mirrors product.tsx's seoPrice
 * rule (sale_price preferred only when it is actually lower).
 *
 * R163: returns BOTH forms — the grouped display string (the canon the
 * WhatsApp card and the page price read identically) and the raw
 * numeric (the shell's Product JSON-LD Offer needs a bare number).
 */
async function shareDisplayPrice(listPrice: string): Promise<{ display: string; numeric: number }> {
  const base = Number(listPrice);
  if (!Number.isFinite(base)) return { display: listPrice, numeric: base };
  const { flashSale, basePrice } = await applyFlashSale(base);
  const numeric = flashSale && basePrice < base ? basePrice : base;
  // R128 (B8-D3): the grouped en-US display form («1,380.00», not
  // «1380.00») — the same canon as the web's formatCurrency, so the
  // WhatsApp/TG card price and the page price read identically.
  return { display: formatLydNumber(numeric), numeric };
}

/**
 * R120-B3 (A7-F17): assemble the share description INSIDE display
 * limits — body sliced to ~150, price suffix appended, then the WHOLE
 * string clamped to 180 (the old slice(0,180) + suffix could overshoot
 * every card's display budget).
 */
function buildShareDescription(description: string | null, displayPrice: string): string {
  const body = (description ?? "اشتراك رقمي أصلي بالدينار الليبي من SubNation")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 150);
  const assembled = `${body} — السعر ${displayPrice} د.ل`;
  return assembled.length <= 180 ? assembled : `${assembled.slice(0, 179)}…`;
}

/**
 * R122 (A7-P2-5): clamp an operator seo_title for the shell, mirroring
 * MetaTags.clamp(text, 60) VERBATIM (frontend/src/components/seo/
 * MetaTags.tsx) so the raw-HTML title and the hydrated title agree on
 * the same 60-char budget. The DB column allows 200; only the DISPLAY
 * is clamped.
 */
function clampSeoTitleForShell(title: string): string {
  if (title.length <= 60) return title;
  // R142 (K-1): cut at the last WORD BOUNDARY inside the budget — the
  // verbatim MetaTags.clamp algorithm (R122-A7). The old raw character
  // cut shipped mid-word shards («…| SubN…») on long titles, disagreeing
  // with the hydrated SERP title; a single unbroken word longer than the
  // budget still falls back to the character cut.
  const sliced = title.slice(0, Math.max(0, 60 - 1)).trimEnd();
  const lastSpace = sliced.lastIndexOf(" ");
  const cut = lastSpace > 0 ? sliced.slice(0, lastSpace) : sliced;
  return cut.trimEnd() + "…";
}

/**
 * R122 (A3-P1): the ONE cached product lookup behind BOTH no-JS share
 * surfaces — resolveSpaShellMeta's /product/* branch (browser/indexer
 * shells) and the unfurler OG card below. Both used to run their own
 * uncached `SELECT … WHERE slug|id AND is_archived=false` (plus the
 * flash-sale stage for the display price) on every request: these GETs
 * are unauthenticated, sit OUTSIDE every rate limiter (all limiters
 * mount under /api), and the shell's response is no-store — so wire-speed
 * /product/<slug> bursts reached Neon directly. Now the row + display
 * price ride the catalog cache idiom (lib/catalog-cache.ts): 60 s TTL,
 * generation-bumped by admin product/variant/flash-sale/pricing CRUD —
 * the same freshness contract the /api/products detail routes accept
 * (their DTO prices are equally flash-sale-derived at 60 s).
 *
 * Dead-slug misses ARE cached ({ found: false }): the A3 attack rotates
 * unique garbage slugs, and an uncached 404 path would leave that DoS
 * surface fully open. Bounded by the LRU entry/byte budget
 * (lib/cache.ts B6-02) — entries here are ~200 B, so a garbage-slug flood
 * evicts old entries instead of growing memory.
 */
export interface ShareSurfaceProduct {
  id: number;
  slug: string | null;
  name: string;
  description: string | null;
  /** R163: the long-form copy the hydrated page's Product LD prefers — kept out of the shell LD only when null. */
  descriptionLong: string | null;
  imageUrl: string | null;
  price: string;
  isActive: boolean;
  seoTitle: string | null;
  seoDescription: string | null;
  /**
   * R163: deliverable-stock count — the SAME stock semantics the public
   * API's is_available rides (stock > 0). The shell's Product JSON-LD
   * Offer asserts OutOfStock from this, so the initial HTML can never
   * claim InStock against a page whose UI says «نفد المخزون».
   */
  stockCount: number;
}

async function lookupProductForShareSurfaces(
  slugOrId: string,
  numeric: number | null,
): Promise<
  | {
      found: false;
    }
  | { found: true; row: ShareSurfaceProduct; displayPrice: string; numericPrice: number }
> {
  // R122 (A3-P1): products.slug is varchar(160) — an over-long slug can
  // NEVER match a row, so answering the miss without a query ALSO keeps
  // attacker-minted multi-KB slugs from becoming LRU KEYS (the byte
  // budget tracks values, not keys). Mirrors the /api/products/by-slug
  // 160-char guard.
  if (numeric === null && slugOrId.length > 160) return { found: false };
  return withCatalogCache(
    "spa-share",
    numeric !== null ? `id:${numeric}` : `slug:${slugOrId}`,
    60,
    async () => {
      const [row] = await db
        .select({
          id: productsTable.id,
          slug: productsTable.slug,
          name: productsTable.name,
          description: productsTable.description,
          descriptionLong: productsTable.descriptionLong,
          imageUrl: productsTable.imageUrl,
          price: productsTable.price,
          isActive: productsTable.isActive,
          // R122 (A7-P1-1): the operator SEO overrides — same columns the
          // hydrated page renders (frontend/src/pages/product.tsx).
          seoTitle: productsTable.seoTitle,
          seoDescription: productsTable.seoDescription,
          // R163: the deliverable-stock scalar — a correlated subquery
          // with the catalog's own is_available predicate (is_sold=false
          // AND at least one credential field present), so the JSON-LD
          // below and the public API can never disagree on stock.
          stockCount: sql<number>`(
            SELECT COUNT(*)::int FROM ${inventoryTable}
            WHERE ${inventoryTable.productId} = ${productsTable.id}
              AND ${inventoryTable.isSold} = false
              AND ${deliverableUnitCondition()}
          )`,
        })
        .from(productsTable)
        .where(
          and(
            numeric !== null ? eq(productsTable.id, numeric) : eq(productsTable.slug, slugOrId),
            // Same WHERE half as every public product surface (D2-F4): an
            // archived row can never render a shell or a share card.
            eq(productsTable.isArchived, false),
          ),
        )
        .limit(1);
      if (!row) return { found: false as const };
      // Flash-aware price folded INTO the cached entry — the 60 s
      // staleness budget matches the share card's own Cache-Control
      // max-age=60 and the detail routes' cached sale_price.
      const share = await shareDisplayPrice(row.price);
      return {
        found: true as const,
        row,
        displayPrice: share.display,
        numericPrice: share.numeric,
      };
    },
  );
}

/**
 * A7-F16: static-shell noindex families — the SAME path families the
 * SPA's NOINDEX_ROUTES (frontend/src/App.tsx) and robots.txt Disallow
 * list cover. `noindex,follow` (not none) so crawlers keep walking
 * outbound links instead of treating them as dangling.
 */
const SHELL_NOINDEX_RES: RegExp[] = [
  /^\/login$/,
  /^\/register$/,
  /^\/forgot-password$/,
  /^\/onboarding(\/|$)/,
  /^\/auth(\/|$)/,
  /^\/cart(\/|$)/,
  /^\/checkout(\/|$)/,
  /^\/wallet(\/|$)/,
  /^\/orders(\/|$)/,
  /^\/loyalty(\/|$)/,
  /^\/referrals(\/|$)/,
  /^\/profile(\/|$)/,
  /^\/admin(\/|$)/,
  /^\/status(\/|$)/,
  // R140 central (140-m flag): the notifications wall — the hydrated SPA
  // stamps noindex,follow (MetaTags) and robots.txt Disallows it (the
  // R128-IMP-5 page), but this static shell stamped index,follow, telling
  // non-rendering engines the opposite. Mirrors the parity rule above.
  /^\/notifications(\/|$)/,
];

/** Resolved per-route shell meta (exported for the shell-rewrite tests). */
export interface SpaShellMeta {
  /** HTTP status for the shell response (200; 404 for dead product slugs). */
  status: number;
  /** Rewrites <title> + og:title when present. */
  title?: string;
  /** Rewrites meta[name=description] + og:description when present. */
  description?: string;
  /** Absolute canonical URL; `null` STRIPS the link; undefined leaves it. */
  canonical?: string | null;
  /** robots override ("noindex,follow" for auth/admin families). */
  robots?: string;
  /** Absolute og:image URL for product pages (A11-F3b, R126-L6).
   *  Rewrites og:image AND strips the baseline og:image:width/height
   *  (the 1200×630 pair belongs to opengraph.jpg; product art carries
   *  its own per-file dimensions — omitted beats wrong). Undefined
   *  leaves the static og set untouched. */
  ogImage?: string;
  /** R142 (K-2): rewrites og:url wherever a canonical is set — the
   *  static baseline's homepage-shaped og:url survived every rewrite,
   *  so every non-home raw shell claimed homepage OG identity. */
  ogUrl?: string;
  /** R142 (K-2): rewrites og:type ("product" on PDP routes — the
   *  static baseline says `website` on every route). */
  ogType?: string;
  /**
   * R163: serialized JSON-LD object to inject as ONE
   * <script type="application/ld+json"> before </head> (the PDP's
   * initial-HTML Product/Offer structured data — see
   * buildShellProductLd). Undefined = no injection.
   */
  jsonLd?: string;
}

/**
 * Pure regex helpers — each rewrites ONLY an existing tag (no insertion):
 * the production shell carries every marker (data-rh), while stub/test
 * shells without a marker pass through untouched.
 */
function rewriteMetaTag(
  html: string,
  attr: "name" | "property",
  key: string,
  content: string,
): string {
  const tagRe = new RegExp(`<meta\\b(?=[^>]*\\b${attr}\\s*=\\s*["']${key}["'])[^>]*>`, "i");
  if (!tagRe.test(html)) return html;
  return html.replace(tagRe, (tag) =>
    tag.replace(/\bcontent\s*=\s*("([^"]*)"|'([^']*)')/i, `content="${escapeHtmlAttr(content)}"`),
  );
}

function rewriteCanonical(html: string, href: string | null): string {
  const linkRe = /<link\b(?=[^>]*\brel\s*=\s*["']canonical["'])[^>]*>/i;
  if (href === null) return html.replace(linkRe, "");
  if (!linkRe.test(html)) return html;
  return html.replace(linkRe, (tag) =>
    tag.replace(/\bhref\s*=\s*("([^"]*)"|'([^']*)')/i, `href="${escapeHtmlAttr(href)}"`),
  );
}

/**
 * A11-F3b (R126-L6): REMOVE an existing meta tag outright (used for the
 * baseline og:image:width/height pair when og:image points at product
 * art — the 1200×630 numbers belong to opengraph.jpg and would be a
 * wrong claim beside a /products/*.webp image; omitted beats wrong).
 * Same marker contract as rewriteMetaTag: no tag, no change.
 */
function removeMetaTag(html: string, attr: "name" | "property", key: string): string {
  const tagRe = new RegExp(`<meta\\b(?=[^>]*\\b${attr}\\s*=\\s*["']${key}["'])[^>]*>\\n?`, "i");
  return html.replace(tagRe, "");
}

/**
 * Apply `rewrite` only to NON-comment segments of the shell (R120 hotfix
 * for the R120-B3 shell rewriter). The production shell carries developer
 * comments that MENTION tag names in prose — e.g. the V3-A1 note
 * "…upsert-by-selector — one <title>, one description, one og set…" sits
 * ~2.6 KB BEFORE the real <title data-rh> tag. A naive
 * /<title\b[^>]*>…<\/title>/ match therefore paired the comment's
 * "<title>" opener with the REAL title's closer and replaced the entire
 * span — deleting the canonical link, every og:/twitter: tag in between
 * and leaving the comment UNCLOSED (9 `<!--` vs 8 `-->` shipped to
 * /category/*). Splitting on comment boundaries makes every rewriter
 * structurally unable to see comment prose as markup.
 */
function rewriteOutsideComments(html: string, rewrite: (segment: string) => string): string {
  // Capture group keeps the comment segments in the split output; map
  // applies the rewriter only to the non-comment parts.
  return html
    .split(/(<!--[\s\S]*?-->)/)
    .map((part) => (part.startsWith("<!--") ? part : rewrite(part)))
    .join("");
}

// ── R136 (PERF #10): bounded memoization of applySpaShellMeta ────────────────
//
// The shell rewrite is a PURE function of (html, meta) — html is the
// boot-time SPA_SHELL_HTML snapshot, meta comes from the small closed
// set resolveSpaShellMeta produces (home/category/static metas, the
// shared noindex stamp, per-product rows riding the 60 s catalog
// cache). Yet every non-API GET paid the full pipeline — a
// comment-boundary split over the whole ~20-30 KB document plus 5+
// regex passes per non-comment segment (title, og:title, description,
// og:description, robots, og:image ± dimension strips, canonical) —
// just to rebuild a byte-identical string. This block memoizes the
// output: a bounded LRU (~200 entries) keyed by the SERIALIZED meta,
// guarded by an html identity check.
//
//   - Key: JSON.stringify(meta). Undefined/absent fields stringify
//     identically AND behave identically in the rewriter, so the key
//     is a faithful equivalence class; field-order permutations at
//     worst duplicate an entry (harmless — same output).
//   - Guard: `html !== memoHtml` (string VALUE equality; O(1) for the
//     hot path, where every caller passes the SAME SPA_SHELL_HTML
//     reference). A different html — the unit tests' stub shells —
//     resets the map, so a cached output can never be served for a
//     different shell. This is the correctness invariant that makes
//     keying on meta alone safe.
//   - Bound: Map insertion order = LRU age; the oldest key is evicted
//     at 200 entries. Real cardinality is ~60 (7 categories + 3
//     statics + home + noindex stamp + 404 stamp + live product rows),
//     so eviction is a safety valve against pathological URL shapes,
//     not an expected event.
//   - Miss path: byte-identical to the pre-R136 rewriter.
const SHELL_META_CACHE_MAX_ENTRIES = 200;
let memoHtml: string | null = null;
const memoEntries = new Map<string, string>();

/**
 * Apply resolved meta to the in-memory shell snapshot (exported for tests).
 * Every tag surgery runs OUTSIDE comments (see rewriteOutsideComments).
 * R136 (PERF #10): memoized — see the cache block above; cache misses
 * are byte-identical to the previous implementation.
 */
export function applySpaShellMeta(html: string, meta: SpaShellMeta): string {
  if (html !== memoHtml) {
    memoHtml = html;
    memoEntries.clear();
  }
  const key = JSON.stringify(meta);
  const hit = memoEntries.get(key);
  if (hit !== undefined) {
    // LRU bump: delete + re-insert moves the key to the newest position
    // (Map iterates in insertion order), so hot routes survive a flood
    // of pathological one-off metas.
    memoEntries.delete(key);
    memoEntries.set(key, hit);
    return hit;
  }
  const output = rewriteSpaShellMeta(html, meta);
  if (memoEntries.size >= SHELL_META_CACHE_MAX_ENTRIES) {
    const oldest = memoEntries.keys().next();
    if (!oldest.done) memoEntries.delete(oldest.value);
  }
  memoEntries.set(key, output);
  return output;
}

/** The uncached rewriter — the pre-R136 applySpaShellMeta body, verbatim. */
function rewriteSpaShellMeta(html: string, meta: SpaShellMeta): string {
  return rewriteOutsideComments(html, (segment) => {
    let out = segment;
    if (meta.title !== undefined) {
      out = out.replace(
        /(<title\b[^>]*>)([\s\S]*?)(<\/title>)/i,
        (_m: string, open: string, _inner: string, close: string) =>
          open + escapeHtmlAttr(meta.title as string) + close,
      );
      out = rewriteMetaTag(out, "property", "og:title", meta.title);
    }
    if (meta.description !== undefined) {
      out = rewriteMetaTag(out, "name", "description", meta.description);
      out = rewriteMetaTag(out, "property", "og:description", meta.description);
    }
    if (meta.robots !== undefined) {
      out = rewriteMetaTag(out, "name", "robots", meta.robots);
    }
    if (meta.ogImage !== undefined) {
      out = rewriteMetaTag(out, "property", "og:image", meta.ogImage);
      // The shipped og:image:width/height pair describes the BASELINE
      // opengraph.jpg — next to product art it would be a wrong
      // dimension claim. Strip (the WhatsApp-proven share card ships
      // og:image without dimension tags too).
      out = removeMetaTag(out, "property", "og:image:width");
      out = removeMetaTag(out, "property", "og:image:height");
    }
    // R142 (K-2): OG identity arms — the raw shell must not claim
    // homepage identity on a product/category route (og:url always said
    // the apex; og:type always said `website`). Same no-tag-no-change
    // contract as every other arm.
    if (meta.ogUrl !== undefined) {
      out = rewriteMetaTag(out, "property", "og:url", meta.ogUrl);
    }
    if (meta.ogType !== undefined) {
      out = rewriteMetaTag(out, "property", "og:type", meta.ogType);
    }
    if (meta.canonical !== undefined) {
      out = rewriteCanonical(out, meta.canonical);
    }
    // R163: the initial-HTML Product structured-data arm. Google's
    // product-snippet technical guidance explicitly recommends putting
    // Product structured data in the initial HTML "for best results" —
    // JS-only markup makes Shopping crawls less reliable for exactly
    // the fields that change (price, availability). The block is a
    // serialized JSON object (@id-anchored to the same node the
    // hydrated page's JsonLd component re-emits, so the two merge into
    // one entity); it is inert data, not executable script — CSP
    // script-src never applies to application/ld+json.
    if (meta.jsonLd !== undefined) {
      out = injectJsonLdScript(out, meta.jsonLd);
    }
    return out;
  });
}

/**
 * Resolve the shell meta for a request path (exported for tests; hits
 * the DB only for /product/*). Trailing slashes are normalized.
 */
export async function resolveSpaShellMeta(pathname: string, origin: string): Promise<SpaShellMeta> {
  const norm = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (norm === "" || norm === "/") {
    // B12-F1 (R127-L9): the static baseline (index.html) ships the
    // generic brand-first default while the hydrated home page renders
    // the keyword-forward copy above — the split meta signal R122
    // (A7-P1-1) eliminated for products. Rewrites <title> + og:title +
    // description + og:description; the static apex canonical,
    // index,follow robots and the og:image set are already correct for
    // "/" and stay untouched (parity-pinned by spa-shell-route-parity).
    return {
      status: 200,
      title: SHELL_HOME_META.title,
      description: SHELL_HOME_META.description,
    };
  }

  const category = /^\/category\/([^/]+)$/.exec(norm);
  if (category) {
    const meta = SHELL_CATEGORY_META[category[1]];
    // Unknown/retired category slug → REAL 404 status, mirroring the
    // unknown-product branch below (R163): the shell still ships so the
    // SPA renders its 404 UI client-side, but the HTTP status is the
    // honest "this URL has no content" signal Google's soft-404
    // guidance asks for. R122 (A7-P1-2) had settled for 200 +
    // noindex,follow; live evidence (R163 SERP research — Google
    // indexed the retired /category/gaming as an error page with the
    // «الفئة غير موجودة» title) showed the 200 status invites the
    // soft-404 state. noindex,follow stays as the belt-and-braces it
    // always was; the canonical stays stripped (an unknown category
    // consolidates nowhere).
    return meta
      ? {
          status: 200,
          title: meta.metaTitle,
          description: meta.metaDescription,
          canonical: `${origin}/category/${category[1]}`,
          // R142 (K-2): OG identity follows the canonical — the raw shell
          // used to keep the static homepage og:url on every category.
          ogUrl: `${origin}/category/${category[1]}`,
        }
      : { status: 404, canonical: null, robots: "noindex,follow" };
  }

  const product = /^\/product\/([^/]+)$/.exec(norm);
  if (product) {
    let slugOrId: string;
    try {
      slugOrId = decodeURIComponent(product[1] as string);
    } catch {
      // R134 (A7-F6): the noindex stamp joins the unknown-path family —
      // HTTP 404 already governs deindexing, but the raw/SPA pair now
      // agrees (the SPA's client-side 404 stamps noindex,follow itself).
      return { status: 404, canonical: null, robots: "noindex,follow" };
    }
    const numeric = /^\d+$/.test(slugOrId) ? Number.parseInt(slugOrId, 10) : null;
    // R122 (A3-P1): the cached lookup shared with the share card (see
    // lookupProductForShareSurfaces) — this branch used to run its own
    // uncached query on every unauthenticated, un-rate-limited GET.
    const lookup = await lookupProductForShareSurfaces(slugOrId, numeric);
    // A7-F7: unknown / inactive / archived product slug → real 404 (the
    // shell still ships so the SPA's not-found page renders client-side).
    // R134 (A7-F6): + noindex,follow — family consistency with the
    // unknown-path/unknown-category shells (harmless beyond the 404
    // itself, but the raw/SPA pair stops disagreeing).
    if (!lookup.found || !lookup.row.isActive)
      return { status: 404, canonical: null, robots: "noindex,follow" };
    const row = lookup.row;
    // R122 (A7-P1-1 + A7-P2-5): prefer the operator's DB-backed SEO
    // overrides — the SAME fields the hydrated page renders
    // (frontend/src/pages/product.tsx: seo_title?.trim() ? seo_title :
    // fallback, description from seo_description sliced to 160). The
    // raw-HTML title used to be English brand-only on every product page
    // while the rendered page showed the Arabic keyword title — a split
    // title signal for every non-rendering engine. Fallbacks keep the
    // pre-R122 behavior (name — SubNation / price-suffixed share copy).
    const seoTitle = row.seoTitle?.trim() || null;
    const seoDescription = row.seoDescription?.trim() || null;
    // A11-F3b (R126-L6): the row's real art as og:image — indexers and
    // no-JS agents used to see only the generic /opengraph.jpg here
    // (unfurlers were covered by the dedicated share-card route; every
    // other consumer wasn't). The lookup already carries imageUrl, so
    // this costs nothing extra. Absolutized exactly like the share
    // card below: DB rows carry site-relative /products/<slug>.webp;
    // already-absolute URLs (future CDN host) pass through untouched.
    // Null imageUrl keeps the static og set (a generic card beats none).
    const ogImage = row.imageUrl
      ? row.imageUrl.startsWith("http")
        ? row.imageUrl
        : `${origin}${row.imageUrl.startsWith("/") ? "" : "/"}${row.imageUrl}`
      : undefined;
    // R163: the initial-HTML Product/Offer structured data — Google's
    // product-snippet guidance recommends it in the initial HTML; the
    // hydrated page re-emits the same @id node (client JsonLd), so the
    // pair merges. Numeric price (flash-aware, the same rule as the
    // share card) + the deliverable-stock scalar drive the Offer
    // honestly. Falls back to undefined (no block) on a non-finite
    // price — never fabricate what the row cannot prove.
    const jsonLd = buildShellProductLd({
      row,
      origin,
      numericPrice: lookup.numericPrice,
      // The LD image mirrors the og:image absolutization (logo fallback
      // — same as the frontend buildProductLd's fallback).
      absoluteImage: ogImage ?? `${origin}/subnation-logo.png`,
    });
    return {
      status: 200,
      title: seoTitle ? clampSeoTitleForShell(seoTitle) : `${row.name} — SubNation`,
      description: seoDescription
        ? // Mirrors the hydrated page's plain .slice(0, 160) — no price
          // suffix, no ellipsis — so both surfaces tell the same story.
          seoDescription.slice(0, 160)
        : buildShareDescription(row.description, lookup.displayPrice),
      // Prefer the row's canonical slug URL (numeric-id requests get
      // replaceState'd to it client-side — R117 F-4).
      canonical: `${origin}/product/${row.slug ?? slugOrId}`,
      ogImage,
      // R142 (K-2): the PDP is an OG `product` object at its own URL —
      // the static baseline said `website` at the apex on every route.
      ogUrl: `${origin}/product/${row.slug ?? slugOrId}`,
      ogType: "product",
      ...(jsonLd !== undefined ? { jsonLd } : {}),
    };
  }

  const staticMeta = SHELL_STATIC_ROUTE_META[norm];
  if (staticMeta) {
    return {
      status: 200,
      title: staticMeta.title,
      description: staticMeta.description,
      canonical: `${origin}${norm}`,
      // R142 (K-2): OG identity follows the canonical.
      ogUrl: `${origin}${norm}`,
    };
  }

  if (SHELL_NOINDEX_RES.some((re) => re.test(norm))) {
    return { status: 200, canonical: null, robots: "noindex,follow" };
  }

  // Unknown public path: strip the canonical — a homepage canonical on
  // an unknown URL is a duplicate-content lie — and stamp noindex,follow
  // (R122 A7-P1-2): the SPA's client-side 404 owns the UX AND already
  // renders noindex for exactly these URLs; the raw shell keeping the
  // static index,follow contradicted it for every non-rendering engine
  // (an unbounded soft-404 crawl space). 200 stays — the SPA must boot
  // to render the 404 UI.
  return { status: 200, canonical: null, robots: "noindex,follow" };
}

/**
 * R111 (D2-F1): the R104 (AG6-2) share-bot predicate, SPLIT in two.
 *
 * The unified predicate matched indexing crawlers (googlebot, bingbot,
 * yandexbot, duckduckbot, baiduspider) alongside unfurlers, so every
 * crawl of /product/* received the ~1KB no-JS OG card instead of the
 * SPA shell — no JSON-LD (Product/FAQ/Breadcrumb), no renderable
 * content: all structured data on the money pages was invisible to
 * Google (its Web Rendering Service fetches the same URL and used to
 * get the same card). The two bot classes want OPPOSITE responses:
 *
 *   (a) UNFURLERS — chat/social link-preview fetchers that never
 *       execute JS. They alone get the DB-backed OG share card.
 *   (b) INDEXERS — search-engine crawlers that render JS (Googlebot
 *       via WRS) or index raw HTML. They get the normal SPA shell.
 *
 * Both regexes are case-insensitive over the raw User-Agent.
 * The unfurler list stays a STRICT allowlist — nothing gets the card
 * unless it is a known link-preview fetcher. The indexer list exists
 * so the card middleware can EXCLUDE crawlers explicitly (belt and
 * suspenders against future list drift); its tokens are chosen to
 * never match a normal browser UA — verified against real strings:
 * Googlebot Smartphone is
 * "… (Linux; Android 6.0.1…) … Chrome/120 … Mobile Safari/537.36
 * (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" —
 * matched by `googlebot`, while ordinary Chrome/Safari/Firefox UAs
 * contain none of these tokens.
 *
 * server.ts's boot gate imports the UNFURLER half (via app.ts's
 * re-export) so the gated set can never drift from the set the
 * OG-card route actually serves (the DB-backed path) — single source,
 * unchanged contract.
 */

/** (a) Link-unfurler bots — the ONLY user agents served the OG card. */
export function isUnfurlerUserAgent(userAgent: string): boolean {
  return /facebookexternalhit|whatsapp|telegrambot|twitterbot|slackbot|discordbot|linkedinbot|pinterestbot|embedly|quora link preview|outbrain|vkshare|vkrobot|showyoubot|citizensinspector/i.test(
    userAgent,
  );
}

/**
 * (b) Indexing crawlers — always served the SPA shell (the OG card
 * would hide every product page from their index).
 */
export function isIndexerUserAgent(userAgent: string): boolean {
  return /googlebot|bingbot|yandexbot|duckduckbot|baiduspider|applebot|petalbot/i.test(userAgent);
}

/**
 * Mount the static-asset routes, the OG-card unfurler middleware and the
 * SPA fallback — the exact `if (frontendDist) { … }` block that used to
 * live inline in app.ts, in the same order with the same options.
 * No-op when no frontend dist was resolved (API-only boots, tests).
 */
export function mountSpaShellRoutes(app: Express): void {
  if (!frontendDist) return;

  // R163 — the IndexNow key file (https://indexnow.org): engines verify
  // ownership by fetching `https://<host>/<key>.txt` and comparing the
  // body to the key used in submissions. The key comes from env config
  // (INDEXNOW_KEY) and NEVER lives in this repo. The route mounts ONLY
  // when the key is configured + valid — unset means the whole IndexNow
  // feature is inert and this path serves the regular SPA fallback.
  const indexNowKeyValue = indexNowKey();
  if (indexNowKeyValue) {
    const keyFileRoute = `/${indexNowKeyValue}.txt`;
    app.get(keyFileRoute, (_req, res) => {
      res
        .set("Content-Type", "text/plain; charset=utf-8")
        // Engines fetch the key file on (nearly) every submission batch;
        // a day of edge cache keeps that off the origin.
        .set("Cache-Control", "public, max-age=86400")
        .send(indexNowKeyValue);
    });
  }

  // Serve hashed assets with 1-year immutable cache (file names change on rebuild)
  app.use(
    "/assets",
    express.static(path.join(frontendDist, "assets"), {
      maxAge: "1y",
      immutable: true,
      // R128 (B2-F2): redirect:false — the DEFAULT directory redirect
      // 301'd the bare /assets probe to /assets/ before the 404 guard
      // below could own it (the A11-F2 /products precedent). With the
      // redirect off, the directory miss falls through both static
      // mounts to the fallback, where the /assets 404 guard answers.
      redirect: false,
    }),
  );

  // Serve other static files (manifest, icons, robots.txt) with short cache
  app.use(
    express.static(frontendDist, {
      maxAge: "1h",
      // B12-F1 (R127-L9): index:false — the DEFAULT directory-index serve
      // made GET / resolve to index.html HERE, so the homepage bypassed
      // the per-route shell rewrite below (resolveSpaShellMeta never saw
      // "/" — its old "homepage shell is already correct" early return
      // was dead code for real traffic, and the raw baseline shipped
      // while every other route got its rewritten meta). Directory
      // requests now fall through to the SPA fallback, which owns ALL
      // html route-serving; the dist root is the only directory with an
      // index.html, so "/" is the one path whose behavior changes.
      // Direct file hits (manifest, icons, robots.txt, and /index.html —
      // the known A11-F6 canonical-consolidation item) are unaffected.
      index: false,
      // A11-F2 (R126-L6): redirect:false — the art directory
      // (frontend/public/products → dist/products) made express.static
      // 301 /products → /products/ on the CATALOG-looking bare path,
      // a +1-RTT double hop for every direct/external hit (and
      // 302+301 from http). With redirects off, a directory hit falls
      // through to the SPA fallback below, which serves the route
      // directly (same shell family /products/ already serves). Real
      // files under /products/<file> are unaffected — only the
      // no-slash DIRECTORY redirect changes.
      redirect: false,
      setHeaders(res, filePath) {
        // HTML, SW, and robots must never be cached aggressively.
        // R104 (AG11-3): registerSW.js (unhashed) joins the no-cache set —
        // a deploy that changed it could otherwise delay SW update
        // registration by up to an hour.
        if (
          filePath.endsWith(".html") ||
          filePath.endsWith("sw.js") ||
          filePath.endsWith("registerSW.js") ||
          filePath.endsWith("robots.txt")
        ) {
          res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
          return;
        }
        // R104 (AG11-2b): product art (frontend/public/products/*.webp) and
        // the PWA icon set are effectively IMMUTABLE (filenames change on
        // replacement — r102's WebP conversion proved the workflow). They
        // rode the 1h default, forcing an hourly conditional-GET round
        // trip per asset per returning visitor; 30d + SWR matches the
        // service worker's CacheFirst window instead. Hashed workbox-*.js
        // chunks are safe to treat the same (content-hash names).
        if (
          filePath.includes("/products/") ||
          /pwa-.*\.png$/.test(filePath) ||
          /workbox-.*\.js$/.test(filePath)
        ) {
          res.setHeader("Cache-Control", "public, max-age=2592000, stale-while-revalidate=86400");
        }
      },
    }),
  );

  // ── A7 (round-94): dynamic share-card OG for link unfurlers ──────────
  // (The bot predicate lives in the exported isUnfurlerUserAgent /
  // isIndexerUserAgent above; server.ts's boot gate gates the SAME
  // unfurler set — single source.)
  //
  // The SPA fallback below serves the STATIC index.html for every GET —
  // so WhatsApp/Facebook/Telegram/Slack unfurlers (which do NOT run JS)
  // saw the generic site title/description/image for EVERY product link.
  // Product shares are the #1 organic channel in Libya; the card is now
  // real per-product data. Only UNFURLER bot UAs on /product/* get this
  // — humans AND indexing crawlers always get the SPA. Any failure falls
  // through to the SPA fallback (share cards degrade gracefully, the
  // page itself never breaks).
  app.use(async (req: Request, res: Response, next: NextFunction) => {
    if ((req.method !== "GET" && req.method !== "HEAD") || req.path.startsWith("/api")) {
      next();
      return;
    }
    const match = /^\/product\/([^/]+)\/?$/.exec(req.path);
    const ua = String(req.headers["user-agent"] ?? "");
    // D2-F1 (R111): UNFURLERS ONLY. The R104 predicate also matched
    // googlebot/bingbot/yandexbot/…, so every crawl of /product/* got
    // this ~1KB JS-less card — no JSON-LD, no SPA boot → all
    // Product/FAQ/Breadcrumb structured data was invisible to Google.
    // Indexing crawlers now fall through to the SPA shell below; the
    // explicit isIndexerUserAgent exclusion keeps the split safe even
    // if a token is ever (mistakenly) added to both lists.
    if (!match || isIndexerUserAgent(ua) || !isUnfurlerUserAgent(ua)) {
      next();
      return;
    }
    try {
      const slugOrId = decodeURIComponent(match[1] as string);
      const numeric = /^\d+$/.test(slugOrId) ? Number.parseInt(slugOrId, 10) : null;
      // R122 (A3-P1): the cached lookup shared with the shell meta layer
      // (lookupProductForShareSurfaces) — this card path is unauthenticated
      // and outside every rate limiter, and a spoofed unfurler UA used to
      // mint a fresh uncached products query per request.
      const lookup = await lookupProductForShareSurfaces(slugOrId, numeric);
      if (!lookup.found || !lookup.row.isActive) {
        next();
        return;
      }
      const product = lookup.row;
      const esc = escapeHtmlAttr;
      const origin = appOrigin();
      const canonical = `${origin}/product/${slugOrId}`;
      // 110-F (R110 — 109-n P2): r103 absolutized og:image in MetaTags but
      // missed this no-JS surface — unfurlers (WhatsApp/Facebook, the
      // dominant share channel in Libya) drop RELATIVE image URLs, so
      // every shared product link unfurled cardless. Absolutize against
      // the SAME origin as the canonical above (APP_URL with the canonical
      // production-domain default — identical to the APP_ORIGIN resolution
      // in routes/seo.ts); DB rows carry site-relative /products/<slug>.webp,
      // already-absolute URLs (future CDN host) pass through untouched.
      const ogImage = product.imageUrl
        ? product.imageUrl.startsWith("http")
          ? product.imageUrl
          : `${origin}${product.imageUrl.startsWith("/") ? "" : "/"}${product.imageUrl}`
        : null;
      // R128 (B8-D1): the operator's curated SEO overrides — the SAME
      // fields the plain-UA shell (resolveSpaShellMeta) and the hydrated
      // page render, with the SAME fallbacks (seo_title?.trim() ? clamped
      // seo_title : `${name} — SubNation`; whitespace-only overrides fall
      // back, not truthiness). The card used to show raw name+description
      // while every other surface showed the curated Arabic — the #1
      // share channel never saw the operator's SEO work. The price suffix
      // on the description stays by design (the share card's one
      // money-forward line).
      const seoTitle = product.seoTitle?.trim() || null;
      const seoDescription = product.seoDescription?.trim() || null;
      const cardTitle = seoTitle ? clampSeoTitleForShell(seoTitle) : `${product.name} — SubNation`;
      // R120-B3 (A7-F9 + A7-F17): assemble the description inside display
      // limits (buildShareDescription) — the seo_description (when set)
      // is the body, keeping the «— السعر X د.ل» suffix.
      const desc = buildShareDescription(
        seoDescription ?? product.description,
        lookup.displayPrice,
      );
      const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<title>${esc(cardTitle)}</title>
<meta property="og:type" content="product">
<meta property="og:site_name" content="SubNation">
<meta property="og:title" content="${esc(cardTitle)}">
<meta property="og:description" content="${esc(desc)}">
${ogImage ? `<meta property="og:image" content="${esc(ogImage)}">` : ""}
<meta property="og:url" content="${esc(canonical)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(cardTitle)}">
<meta name="twitter:description" content="${esc(desc)}">
</head>
<body>متجرك الرقمي الأول في ليبيا — <a href="${esc(canonical)}">${esc(product.name)}</a></body>
</html>`;
      // Bots re-fetch sparingly; a short edge cache (Cloudflare in front)
      // collapses card-request bursts without ever serving a stale price
      // to humans (humans get the SPA through a different path).
      res.setHeader("Cache-Control", "public, max-age=60, s-maxage=300");
      res.setHeader("Content-Language", "ar");
      res.type("html").send(html);
    } catch {
      next();
    }
  });

  app.use(async (req: Request, res: Response, next: NextFunction) => {
    if ((req.method !== "GET" && req.method !== "HEAD") || req.path.startsWith("/api")) {
      next();
      return;
    }

    // R128 (B2-F2): hashed /assets/* misses must 404, never soft-200 the
    // SPA shell. express.static only answers files it FINDS — a missing
    // /assets/index-abc123.js fell through both static mounts to this
    // fallback and got 200 + text/html index.html (live probe 2026-10-10:
    // /assets/missing → 200 HTML). Real asset URLs are content-hashed
    // build artifacts: any /assets/* path that misses the mount is, by
    // construction, a stale link or a scanner probe — the honest answer
    // is 404 (plain text; no HTML body to mislead, no shell to cache).
    if (req.path === "/assets" || req.path.startsWith("/assets/")) {
      res.status(404).type("text").send("Not Found");
      return;
    }

    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    // Secondary language signal for crawlers (lang+dir on <html> is the
    // primary; the response header is supplementary). The site is
    // currently Arabic-only — when an English locale ships, swap this
    // to derive from the request path / Accept-Language.
    res.setHeader("Content-Language", "ar");

    // R120-B3 (A7-F3/F7/F16): per-route shell rewrite — see the
    // SPA_SHELL_HTML block above for the full rationale. Degrade to the
    // untouched shell when the boot-time read failed or the /product/*
    // DB lookup hiccups: the SEO meta layer is best-effort and must
    // never take the page down.
    if (!SPA_SHELL_HTML) {
      res.sendFile(path.join(frontendDist, "index.html"));
      return;
    }
    let meta: SpaShellMeta;
    try {
      meta = await resolveSpaShellMeta(req.path, appOrigin());
    } catch {
      meta = { status: 200 };
    }
    res.status(meta.status).type("html").send(applySpaShellMeta(SPA_SHELL_HTML, meta));
  });
}
