import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Express } from "express";
import { eq } from "drizzle-orm";
import { db, initTestDb, productsTable, resetTestDb, flashSalesTable } from "../test/db";
// R122 (A3-P1): the share card's product lookup now rides the catalog
// cache — the admin-CRUD generation bump keeps each test's re-seeded
// rows fresh (module state persists across `it`s).
import { bumpCatalogCache } from "../lib/catalog-cache";

/**
 * R111 (D2-F1 + D2-F4) — share-card crawler split + archived WHERE.
 *
 * D2-F1 (P1): the R104 `isShareBotUserAgent` predicate matched indexing
 * crawlers (googlebot/bingbot/yandexbot/duckduckbot/baiduspider) alongside
 * unfurlers, so EVERY crawl of /product/* got the ~1KB JS-less OG card
 * instead of the SPA shell — no JSON-LD, no renderable content: all
 * Product/FAQ/Breadcrumb structured data on the 45 money pages was
 * invisible to Google (its renderer fetches the same URL). These tests pin
 * the split through the REAL app composition:
 *
 *   - UNFURLERS (WhatsApp/Facebook/…) → the DB-backed OG card;
 *   - INDEXERS (Googlebot desktop AND the Smartphone UA that also carries
 *     Chrome+Mobile tokens, Bingbot, …) and normal browsers → the SPA shell.
 *
 * D2-F4 (P3, the WHERE half): the share-card query now mirrors the detail
 * route's WHERE (isArchived=false), so an archived row can never render a
 * card even if a PATCH re-activates it (the PATCH-side guard is a sibling
 * fix; today archived ⇒ is_active=false, so this is latent-hardening).
 *
 * Harness notes:
 *   - `FRONTEND_DIST` is pointed at a STUB index.html with a deterministic
 *     marker BEFORE importing ../app — resolveFrontendDist() runs at module
 *     load, and the assertions must distinguish "the SPA shell" from "the
 *     card" without depending on a real frontend build being present.
 *   - The pglite harness backs BOTH the app's queries (via the
 *     `@workspace/db` vitest alias) and this file's seeding — same module
 *     instance, same in-memory database.
 */

process.env.ENCRYPTION_KEY ??= "11".repeat(32);

const SPA_MARKER = "SUBNATION-SPA-SHELL-STUB";
const SPA_STUB_HTML = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head><meta charset="utf-8"><title>SPA stub</title></head>
<body><div id="root">${SPA_MARKER}</div></body>
</html>`;
const stubDistDir = mkdtempSync(path.join(tmpdir(), "subnation-spa-stub-"));
writeFileSync(path.join(stubDistDir, "index.html"), SPA_STUB_HTML);
// Must be set before the dynamic import below — app.ts resolves the dist
// directory at module load.
process.env.FRONTEND_DIST = stubDistDir;

/** Real-world UA strings — the exact shapes the split must classify. */
const UA = {
  // ── Indexing crawlers (SPA shell) ──
  googlebotDesktop: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  // The tricky one: contains Chrome + Mobile + Safari tokens like a real
  // Android browser, plus the Googlebot signature. Must land on the SPA.
  googlebotSmartphone:
    "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.224 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  bingbot: "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
  yandexbot: "Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)",
  duckduckbot: "Mozilla/5.0 (compatible; DuckDuckBot/1.0; +http://duckduckgo.com/duckduckbot.html)",
  baiduspider:
    "Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)",
  applebot:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_10_1) AppleWebKit/600.2.5 (KHTML, like Gecko) Version/8.0.3 Safari/600.2.5 (compatible: Applebot/0.1; +http://www.apple.com/go/applebot)",
  petalbot: "Mozilla/5.0 (compatible; PetalBot; +https://webmaster.petalsearch.com/site/petalbot)",
  // ── Unfurlers (OG card) ──
  whatsapp: "WhatsApp/2.23.20.0",
  facebook: "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
  telegram: "TelegramBot (like TwitterBot)",
  twitter: "Twitterbot/1.0",
  slack: "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
  discord: "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)",
  linkedin: "LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)",
  // ── Normal browsers (SPA shell, never the card) ──
  chromeAndroid:
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
  safariMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
  firefox: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
} as const;

type AppModule = typeof import("../app");
let appModule: AppModule;
let realApp: Express;

let activeProduct: { id: number; slug: string | null };
let inactiveProduct: { id: number; slug: string | null };
/** D2-F4 latent shape: archived row whose is_active was flipped back on. */
let archivedActiveProduct: { id: number; slug: string | null };

beforeAll(async () => {
  await initTestDb();
  appModule = await import("../app");
  realApp = appModule.default;
}, 60_000);

afterAll(() => {
  // Keep the throwaway FRONTEND_DIST from leaking into sibling test files
  // sharing this worker process.
  delete process.env.FRONTEND_DIST;
  rmSync(stubDistDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await resetTestDb();
  // R122 (A3-P1): the card's /product/* lookup is cached for 60 s — the
  // admin-CRUD generation bump keeps the re-seeded rows below visible to
  // every test.
  bumpCatalogCache();
  const [active] = await db
    .insert(productsTable)
    .values({
      name: "Netflix بطاقة الاختبار",
      slug: "netflix-share-card",
      description: "اشتراك اختبار البطاقة",
      price: "79.80",
      category: "streaming",
      imageUrl: "/products/netflix-share-card.webp",
      isActive: true,
    })
    .returning({ id: productsTable.id, slug: productsTable.slug });
  const [inactive] = await db
    .insert(productsTable)
    .values({
      name: "منتج موقوف",
      slug: "inactive-share-card",
      description: "منتج موقوف",
      price: "10.00",
      category: "streaming",
      isActive: false,
    })
    .returning({ id: productsTable.id, slug: productsTable.slug });
  const [archivedActive] = await db
    .insert(productsTable)
    .values({
      name: "منتج مؤرشف معاد تشغيله",
      slug: "archived-share-card",
      description: "isArchived=true وis_active=true",
      price: "20.00",
      category: "streaming",
      isActive: true,
      isArchived: true,
    })
    .returning({ id: productsTable.id, slug: productsTable.slug });
  activeProduct = active;
  inactiveProduct = inactive;
  archivedActiveProduct = archivedActive;
});

// ── Shared HTTP harness (same listen/fetch pattern as csrf-gate.test.ts) ──

async function get(
  path: string,
  userAgent: string,
): Promise<{ status: number; body: string; contentType: string; cacheControl: string }> {
  return new Promise((resolve, reject) => {
    const server = realApp.listen(0, async () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("listener address is not AddressInfo"));
        return;
      }
      try {
        const res = await fetch(`http://127.0.0.1:${addr.port}${path}`, {
          headers: { "User-Agent": userAgent },
        });
        resolve({
          status: res.status,
          body: await res.text(),
          contentType: res.headers.get("content-type") ?? "",
          cacheControl: res.headers.get("cache-control") ?? "",
        });
      } catch (err) {
        reject(err);
      } finally {
        server.close();
      }
    });
  });
}

const isCard = (r: { body: string }) => r.body.includes('property="og:title"');
const isSpaShell = (r: { body: string }) => r.body.includes(SPA_MARKER);

// ── D2-F1: predicate units ──────────────────────────────────────────────────

describe("share-card bot predicate split (D2-F1) — units", () => {
  it("unfurler allowlist matches every real unfurler UA string", () => {
    for (const ua of [
      UA.whatsapp,
      UA.facebook,
      UA.telegram,
      UA.twitter,
      UA.slack,
      UA.discord,
      UA.linkedin,
    ]) {
      expect(appModule.isUnfurlerUserAgent(ua)).toBe(true);
      expect(appModule.isIndexerUserAgent(ua)).toBe(false);
    }
  });

  it("indexer list matches every real indexing-crawler UA string (incl. Googlebot Smartphone with Chrome+Mobile tokens)", () => {
    for (const ua of [
      UA.googlebotDesktop,
      UA.googlebotSmartphone,
      UA.bingbot,
      UA.yandexbot,
      UA.duckduckbot,
      UA.baiduspider,
      UA.applebot,
      UA.petalbot,
    ]) {
      expect(appModule.isIndexerUserAgent(ua)).toBe(true);
      // The card must never intercept an indexing crawler.
      expect(appModule.isUnfurlerUserAgent(ua)).toBe(false);
    }
  });

  it("neither predicate matches a normal browser UA (strict allowlists)", () => {
    for (const ua of [UA.chromeAndroid, UA.safariMac, UA.firefox]) {
      expect(appModule.isUnfurlerUserAgent(ua)).toBe(false);
      expect(appModule.isIndexerUserAgent(ua)).toBe(false);
    }
  });

  it("empty UA matches neither predicate", () => {
    expect(appModule.isUnfurlerUserAgent("")).toBe(false);
    expect(appModule.isIndexerUserAgent("")).toBe(false);
  });
});

// ── D2-F1: the real middleware composition ──────────────────────────────────

describe("share-card vs SPA shell through the real app (D2-F1)", () => {
  it("whatsapp UA on /product/:slug → the OG share CARD (unfurlers keep the card)", async () => {
    const r = await get(`/product/${activeProduct.slug}`, UA.whatsapp);
    expect(r.status).toBe(200);
    expect(r.contentType).toContain("text/html");
    expect(isCard(r)).toBe(true);
    expect(r.body).toContain(activeProduct.slug);
    expect(isSpaShell(r)).toBe(false);
    // Edge cache hint rides the card path only.
    expect(r.cacheControl).toContain("max-age=60");
  });

  it("facebook UA on /product/:slug → the OG share CARD", async () => {
    const r = await get(`/product/${activeProduct.slug}`, UA.facebook);
    expect(isCard(r)).toBe(true);
    expect(isSpaShell(r)).toBe(false);
  });

  it("googlebot DESKTOP UA on /product/:slug → the SPA SHELL, not the card (the P1 fix)", async () => {
    const r = await get(`/product/${activeProduct.slug}`, UA.googlebotDesktop);
    expect(r.status).toBe(200);
    expect(isSpaShell(r)).toBe(true);
    expect(isCard(r)).toBe(false);
    // The SPA shell must not carry the card's edge-cache hint.
    expect(r.cacheControl).toContain("no-store");
  });

  it("googlebot SMARTPHONE UA (Chrome+Mobile tokens + Googlebot signature) → the SPA SHELL", async () => {
    const r = await get(`/product/${activeProduct.slug}`, UA.googlebotSmartphone);
    expect(isSpaShell(r)).toBe(true);
    expect(isCard(r)).toBe(false);
  });

  it.each([
    ["bingbot", UA.bingbot],
    ["yandexbot", UA.yandexbot],
    ["duckduckbot", UA.duckduckbot],
    ["baiduspider", UA.baiduspider],
    ["applebot", UA.applebot],
    ["petalbot", UA.petalbot],
  ])("%s UA on /product/:slug → the SPA SHELL", async (_name, ua) => {
    const r = await get(`/product/${activeProduct.slug}`, ua);
    expect(isSpaShell(r)).toBe(true);
    expect(isCard(r)).toBe(false);
  });

  it("a normal Chrome Android UA on /product/:slug → the SPA SHELL (unchanged)", async () => {
    const r = await get(`/product/${activeProduct.slug}`, UA.chromeAndroid);
    expect(isSpaShell(r)).toBe(true);
    expect(isCard(r)).toBe(false);
  });

  it("non-product paths never see the card even for unfurler UAs (unchanged scope)", async () => {
    const r = await get("/", UA.whatsapp);
    expect(isSpaShell(r)).toBe(true);
    expect(isCard(r)).toBe(false);
  });
});

// ── D2-F4 (WHERE half): archived rows never render a card ───────────────────

describe("share-card archived WHERE (D2-F4)", () => {
  it("whatsapp UA on an ARCHIVED-but-active product (by slug) → NO card; the SPA shell answers 404 (R120-B3 A7-F7)", async () => {
    const r = await get(`/product/${archivedActiveProduct.slug}`, UA.whatsapp);
    // R120-B3 (A7-F7): dead product slugs no longer answer 200 — the
    // shell still ships (client-side 404 UX) but with a REAL 404 status
    // so crawlers stop seeing a soft-404. Was: expect(200).
    expect(r.status).toBe(404);
    expect(isSpaShell(r)).toBe(true);
    expect(isCard(r)).toBe(false);
  });

  it("whatsapp UA on an ARCHIVED-but-active product (by numeric id) → NO card; shell 404 (A7-F7)", async () => {
    const r = await get(`/product/${archivedActiveProduct.id}`, UA.whatsapp);
    expect(r.status).toBe(404);
    expect(isSpaShell(r)).toBe(true);
    expect(isCard(r)).toBe(false);
  });

  it("whatsapp UA on an INACTIVE product → NO card; shell 404 (A7-F7)", async () => {
    const r = await get(`/product/${inactiveProduct.slug}`, UA.whatsapp);
    expect(r.status).toBe(404);
    expect(isSpaShell(r)).toBe(true);
    expect(isCard(r)).toBe(false);
  });

  it("control: the same whatsapp UA on the ACTIVE product still gets the card (the WHERE did not over-reach)", async () => {
    const r = await get(`/product/${activeProduct.slug}`, UA.whatsapp);
    expect(r.status).toBe(200);
    expect(isCard(r)).toBe(true);
  });
});

// ── R120-B3 (A7-F9 + A7-F17): the card's price + description budget ─────────

describe("share card price + description (R120-B3 A7-F9/A7-F17)", () => {
  it("an active flash sale drives the CARD price too (list 79.80 → 25% → 59.85)", async () => {
    await db.insert(flashSalesTable).values({
      title: "عرض فلاش اختبار",
      discountPercent: "25.00",
      endsAt: new Date(Date.now() + 60 * 60 * 1000),
      isActive: true,
    });

    const r = await get(`/product/${activeProduct.slug}`, UA.whatsapp);
    expect(isCard(r)).toBe(true);
    // The flash-sale price rides the card description (the same
    // lib/pricing.ts stage the catalog applies) — not the list price.
    expect(r.body).toContain("السعر 59.85 د.ل");
    expect(r.body).not.toContain("السعر 79.80");
  });

  it("the assembled card description stays inside the 180-char display budget", async () => {
    await db
      .update(productsTable)
      .set({ description: "ط".repeat(300) })
      .where(eq(productsTable.id, activeProduct.id));

    const r = await get(`/product/${activeProduct.slug}`, UA.whatsapp);
    expect(isCard(r)).toBe(true);
    const desc = r.body.match(/property="og:description" content="([^"]*)"/)?.[1] ?? "";
    // 150-char body slice + " — السعر 79.80 د.ل" suffix, assembled ≤ 180
    // (the OLD slice(0,180) + suffix could overshoot the budget).
    expect(desc.length).toBeGreaterThan(0);
    expect(desc.length).toBeLessThanOrEqual(180);
    expect(desc.startsWith("ط".repeat(150))).toBe(true);
    expect(desc).toContain("السعر 79.80 د.ل");
  });
});

// ── R122 (A3-P1): the card's product lookup rides the catalog cache ─────────

describe("share card product lookup — catalog-cache contract (R122 A3-P1)", () => {
  it("a repeat card GET serves the CACHED row for 60 s; bumpCatalogCache() (admin CRUD) refreshes it", async () => {
    const slug = activeProduct.slug!;
    // Prime the cache.
    const first = await get(`/product/${slug}`, UA.whatsapp);
    expect(isCard(first)).toBe(true);
    expect(first.body).toContain("Netflix بطاقة الاختبار");

    // Direct DB edit (no bump) — the cached card must keep the OLD name
    // within the TTL (pins that the cache exists on the card path too;
    // a spoofed-unfurler burst used to mint a fresh query per request).
    await db
      .update(productsTable)
      .set({ name: "اسم جديد بعد الكاش" })
      .where(eq(productsTable.id, activeProduct.id));
    const stale = await get(`/product/${slug}`, UA.whatsapp);
    expect(isCard(stale)).toBe(true);
    expect(stale.body).toContain("Netflix بطاقة الاختبار");

    // The admin-CRUD invalidation hook orphans the entry → fresh card.
    bumpCatalogCache();
    const fresh = await get(`/product/${slug}`, UA.whatsapp);
    expect(isCard(fresh)).toBe(true);
    expect(fresh.body).toContain("اسم جديد بعد الكاش");
    // The card's own edge-cache hint is unchanged.
    expect(fresh.cacheControl).toContain("max-age=60");
  });
});
