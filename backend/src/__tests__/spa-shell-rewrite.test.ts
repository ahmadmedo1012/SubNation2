import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Express } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  initTestDb,
  productsTable,
  productVariantsTable,
  resetTestDb,
  flashSalesTable,
  inventoryTable,
} from "../test/db";
// R122 (A3-P1): the shell's /product/* lookup now rides the catalog
// cache — the same generation bump admin CRUD performs keeps each
// test's re-seeded rows fresh (module state persists across `it`s).
import { bumpCatalogCache } from "../lib/catalog-cache";

/**
 * R120-B3 (A7-F3 / A7-F7 / A7-F16) — the per-route SPA-shell rewrite.
 *
 * The SPA fallback used to send the BYTE-IDENTICAL index.html for every
 * URL: every no-JS crawler read the homepage canonical on /category/vpn,
 * dead product slugs answered 200 (soft-404s), and the auth/transactional
 * families said index,follow in raw HTML. These tests pin the rewrite
 * layer through the REAL app composition (the share-card-bot-split
 * harness pattern — a STUB dist with a deterministic marker + the full
 * production marker set installed BEFORE importing ../app):
 *
 *   A7-F3: /category/:slug, /product/:slug, /flash-sales, /support,
 *          /terms get their REAL canonical + title + description.
 *   B12-F1 (R127-L9): / gets the HOME runtime copy (title/description
 *          + their og twins) — the static baseline was the generic
 *          brand-first default while the rendered page showed the
 *          keyword-forward Arabic title.
 *   A7-F7: unknown / inactive / archived product slugs → REAL 404 (the
 *          shell still ships so the SPA's client-side 404 renders).
 *   A7-F16: login/register/cart/wallet/checkout/orders/profile/admin
 *          families get noindex,follow + the homepage canonical STRIPPED;
 *          unknown paths get NO canonical at all.
 *
 * Plus the share-surface price/description contract that rides the same
 * lookup (A7-F9: flash-sale price preferred; A7-F17: assembled
 * description clamped to ≤180).
 *
 * Harness note: FRONTEND_DIST must point at the stub BEFORE the dynamic
 * import — app.ts reads the shell into memory at module load
 * (SPA_SHELL_HTML), so the stub's markers are what the rewrite edits.
 */

process.env.ENCRYPTION_KEY ??= "11".repeat(32);

/** The production marker set (index.html) in stub form. */
const SPA_STUB_HTML = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<title>SubNation — سوق الاشتراكات الرقمية</title>
<meta name="robots" content="index,follow">
<meta name="description" content="BASELINE DESCRIPTION">
<meta property="og:title" content="BASELINE OG TITLE">
<meta property="og:description" content="BASELINE OG DESCRIPTION">
<meta property="og:image" content="https://subnation.ly/opengraph.jpg">
<meta property="og:image:width" content="1280">
<meta property="og:image:height" content="720">
<meta property="og:url" content="https://subnation.ly/">
<meta property="og:type" content="website">
<link rel="canonical" href="https://subnation.ly/">
</head>
<body><div id="root">SUBNATION-SPA-SHELL-STUB</div></body>
</html>`;
const stubDistDir = mkdtempSync(path.join(tmpdir(), "subnation-shell-stub-"));
writeFileSync(path.join(stubDistDir, "index.html"), SPA_STUB_HTML);
// Must be set before the dynamic import below — app.ts resolves the dist
// directory (and reads the shell) at module load.
process.env.FRONTEND_DIST = stubDistDir;

const UA_BROWSER =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

type AppModule = typeof import("../app");
let appModule: AppModule;
let realApp: Express;

let activeProduct: { id: number; slug: string };
let inactiveProduct: { id: number; slug: string };
let archivedProduct: { id: number; slug: string };

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
  // R122 (A3-P1): the /product/* shell lookup is cached for 60 s — the
  // admin-CRUD generation bump keeps the re-seeded rows below visible to
  // every test (same contract the /api/products detail routes' tests ride).
  bumpCatalogCache();
  const [active] = await db
    .insert(productsTable)
    .values({
      name: "ExpressVPN اشتراك اختبار",
      slug: "expressvpn-shell-test",
      description: "اشتراك VPN اختبار القشرة الثابتة",
      price: "100.00",
      category: "vpn",
      imageUrl: "/products/expressvpn.webp",
      isActive: true,
    })
    .returning({ id: productsTable.id, slug: productsTable.slug });
  const [inactive] = await db
    .insert(productsTable)
    .values({
      name: "منتج موقوف",
      slug: "inactive-shell-test",
      description: "منتج موقوف",
      price: "10.00",
      category: "vpn",
      isActive: false,
    })
    .returning({ id: productsTable.id, slug: productsTable.slug });
  const [archived] = await db
    .insert(productsTable)
    .values({
      name: "منتج مؤرشف",
      slug: "archived-shell-test",
      description: "مؤرشف",
      price: "20.00",
      category: "vpn",
      isActive: true,
      isArchived: true,
    })
    .returning({ id: productsTable.id, slug: productsTable.slug });
  activeProduct = { id: active.id, slug: active.slug! };
  inactiveProduct = { id: inactive.id, slug: inactive.slug! };
  archivedProduct = { id: archived.id, slug: archived.slug! };
});

// ── Shared HTTP harness (the share-card-bot-split listen/fetch pattern) ────

interface ShellResponse {
  status: number;
  body: string;
  contentType: string;
  cacheControl: string;
  location: string | null;
}

async function get(
  pathname: string,
  userAgent = UA_BROWSER,
  redirect: "follow" | "manual" | "error" = "follow",
): Promise<ShellResponse> {
  return new Promise((resolve, reject) => {
    const server = realApp.listen(0, async () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("listener address is not AddressInfo"));
        return;
      }
      try {
        const res = await fetch(`http://127.0.0.1:${addr.port}${pathname}`, {
          headers: { "User-Agent": userAgent },
          redirect,
        });
        resolve({
          status: res.status,
          body: await res.text(),
          contentType: res.headers.get("content-type") ?? "",
          cacheControl: res.headers.get("cache-control") ?? "",
          location: res.headers.get("location"),
        });
      } catch (err) {
        reject(err);
      } finally {
        server.close();
      }
    });
  });
}

// ── Body readers (regex over the rewritten shell) ───────────────────────────

function titleOf(body: string): string | null {
  return body.match(/<title>([^<]*)<\/title>/i)?.[1] ?? null;
}

function metaContent(body: string, attr: "name" | "property", key: string): string | null {
  const tag = body.match(new RegExp(`<meta[^>]*\\b${attr}\\s*=\\s*"${key}"[^>]*>`, "i"))?.[0];
  if (!tag) return null;
  return tag.match(/\bcontent\s*=\s*"([^"]*)"/i)?.[1] ?? null;
}

function canonicalOf(body: string): string | null {
  return body.match(/<link[^>]*\brel\s*=\s*"canonical"[^>]*>/i)?.[0] ?? null;
}

function canonicalHref(body: string): string | null {
  return canonicalOf(body)?.match(/\bhref\s*=\s*"([^"]*)"/i)?.[1] ?? null;
}

const isSpaShell = (r: ShellResponse) => r.body.includes("SUBNATION-SPA-SHELL-STUB");

// ── A7-F3: per-route canonical + title + description ───────────────────────

describe("SPA shell rewrite — known public routes (A7-F3)", () => {
  it("/ gets the HOME runtime copy — title/description + og twins rewritten, baseline canonical/robots/og:image untouched (B12-F1)", async () => {
    const r = await get("/");
    expect(r.status).toBe(200);
    expect(isSpaShell(r)).toBe(true);
    // The hydrated page's exact copy (home.tsx useSeo — pinned verbatim
    // by spa-shell-route-parity.test.ts) — NOT the stub's generic
    // baseline. The old "homepage shell is already correct" pass-through
    // was B12-F1: every non-rendering engine saw the brand-first title
    // where the rendered page showed this keyword-forward one.
    expect(titleOf(r.body)).toBe("سوق الاشتراكات الرقمية في ليبيا | SubNation");
    expect(metaContent(r.body, "property", "og:title")).toBe(
      "سوق الاشتراكات الرقمية في ليبيا | SubNation",
    );
    expect(metaContent(r.body, "name", "description")).toBe(
      "متجر اشتراكات رقمية في ليبيا — نتفلكس، سبوتيفاي، ChatGPT وأكثر بالدينار الليبي. الدفع عبر ليبيانا ومدار وLyPay، تسليم فوري، دعم محلي.",
    );
    expect(metaContent(r.body, "property", "og:description")).toBe(
      "متجر اشتراكات رقمية في ليبيا — نتفلكس، سبوتيفاي، ChatGPT وأكثر بالدينار الليبي. الدفع عبر ليبيانا ومدار وLyPay، تسليم فوري، دعم محلي.",
    );
    // The static apex canonical, robots and og:image set were already
    // correct for "/" — the home rewrite must not touch them.
    expect(canonicalHref(r.body)).toBe("https://subnation.ly/");
    expect(metaContent(r.body, "name", "robots")).toBe("index,follow");
    expect(metaContent(r.body, "property", "og:image")).toBe("https://subnation.ly/opengraph.jpg");
    expect(r.body).toContain('property="og:image:width" content="1280"');
  });

  it("/category/vpn gets the category metaTitle + description + own canonical", async () => {
    const r = await get("/category/vpn");
    expect(r.status).toBe(200);
    expect(isSpaShell(r)).toBe(true);
    // The category map's meta (NOT the homepage baseline). Branded
    // ≤60ch titles since R124 (A10-F5) — kept in lockstep with
    // SHELL_CATEGORY_META by the parity suite.
    expect(titleOf(r.body)).toBe("اشتراكات VPN في ليبيا — ExpressVPN | SubNation");
    expect(metaContent(r.body, "name", "description")).toContain("ExpressVPN");
    expect(metaContent(r.body, "property", "og:title")).toBe(
      "اشتراكات VPN في ليبيا — ExpressVPN | SubNation",
    );
    expect(canonicalHref(r.body)).toBe("https://subnation.ly/category/vpn");
    // Public money route stays indexable.
    expect(metaContent(r.body, "name", "robots")).toBe("index,follow");
    // R177 (RH-55): the raw category HTML carries the crawler-visible
    // BreadcrumbList + CollectionPage pair (previously zero JSON-LD).
    expect(r.body).toContain('"@type":"BreadcrumbList"');
    expect(r.body).toContain('"@type":"CollectionPage"');
    expect(r.body).toContain('"@id":"https://subnation.ly/category/vpn#breadcrumb"');
  });

  it("/flash-sales, /support and /terms get their static per-route meta", async () => {
    const flash = await get("/flash-sales");
    expect(titleOf(flash.body)).toBe("عروض فلاش — SubNation");
    expect(canonicalHref(flash.body)).toBe("https://subnation.ly/flash-sales");
    // R143 (L12-1): the shell now serves the HONEST no-sale arm of the
    // runtime-gated description — the static shell cannot know sale
    // state, so it must never promise «عروض فلاش بخصومات حقيقية…»
    // while the page itself may render «لا عرض نشط حالياً» (the
    // J-3/F1 truthfulness class). The hydrated page upgrades the meta
    // client-side when a sale is actually live. Pinned verbatim by
    // spa-shell-route-parity.test.ts (the no-sale-arm extractor).
    expect(metaContent(flash.body, "name", "description")).toBe(
      "صفحة عروض SubNation — تابع العروض الموسمية على الاشتراكات الرقمية بالدينار الليبي مع تسليم فوري في كامل ليبيا.",
    );
    expect(metaContent(flash.body, "property", "og:description")).toBe(
      "صفحة عروض SubNation — تابع العروض الموسمية على الاشتراكات الرقمية بالدينار الليبي مع تسليم فوري في كامل ليبيا.",
    );

    const support = await get("/support");
    expect(titleOf(support.body)).toBe("الدعم والأسئلة الشائعة — SubNation");
    expect(canonicalHref(support.body)).toBe("https://subnation.ly/support");

    const terms = await get("/terms");
    expect(titleOf(terms.body)).toBe("الشروط والأحكام — SubNation");
    expect(canonicalHref(terms.body)).toBe("https://subnation.ly/terms");
  });

  it("/product/:slug (browser UA) gets the DB row's title + slug canonical + clamped description", async () => {
    const r = await get(`/product/${activeProduct.slug}`);
    expect(r.status).toBe(200);
    expect(titleOf(r.body)).toBe("ExpressVPN اشتراك اختبار — SubNation");
    expect(canonicalHref(r.body)).toBe(`https://subnation.ly/product/${activeProduct.slug}`);
    // A7-F17: the assembled description stays inside the 180-char budget.
    const desc = metaContent(r.body, "name", "description");
    expect(desc).toContain("السعر 100.00 د.ل");
    expect(desc!.length).toBeLessThanOrEqual(180);
  });

  // ── R122 (A7-P1-1 + A7-P2-5): DB-backed seo_title / seo_description ──

  it("R122: a row with seo_title/seo_description ships THEM in the raw shell (not the English brand fallback)", async () => {
    const [seoRow] = await db
      .insert(productsTable)
      .values({
        name: "Netflix Premium",
        slug: "netflix-seo-shell-test",
        description: "وصف عادي",
        price: "63.84",
        category: "streaming",
        seoTitle: "Netflix — اشتراك أصلي بالدينار الليبي | SubNation",
        seoDescription: "اشتراك Netflix Premium أصلي بالدينار الليبي مع تسليم فوري بعد الدفع.",
        isActive: true,
      })
      .returning({ slug: productsTable.slug });

    const r = await get(`/product/${seoRow.slug}`);
    expect(r.status).toBe(200);
    // The operator override — NOT `${name} — SubNation` (A7-P1-1: the
    // raw-HTML title used to be English brand-only while the hydrated
    // page showed the Arabic keyword title).
    expect(titleOf(r.body)).toBe("Netflix — اشتراك أصلي بالدينار الليبي | SubNation");
    expect(metaContent(r.body, "property", "og:title")).toBe(
      "Netflix — اشتراك أصلي بالدينار الليبي | SubNation",
    );
    // The seo_description VERBATIM (≤160) — no price suffix, mirroring
    // the hydrated page's .slice(0, 160) (A7-P2-5: both surfaces tell
    // the same story).
    expect(metaContent(r.body, "name", "description")).toBe(
      "اشتراك Netflix Premium أصلي بالدينار الليبي مع تسليم فوري بعد الدفع.",
    );
    expect(canonicalHref(r.body)).toBe(`https://subnation.ly/product/${seoRow.slug}`);
  });

  it("R122: an over-long seo_title clamps to the MetaTags 60-char budget; an over-long seo_description slices at 160", async () => {
    const [seoRow] = await db
      .insert(productsTable)
      .values({
        name: "Clamp Product",
        slug: "clamp-seo-shell-test",
        price: "10.00",
        category: "tools",
        // 70 chars → clamped like MetaTags.clamp(title, 60).
        seoTitle: "T".repeat(70),
        // 200 chars → sliced at 160 like product.tsx's description.
        seoDescription: "D".repeat(200),
        isActive: true,
      })
      .returning({ slug: productsTable.slug });

    const r = await get(`/product/${seoRow.slug}`);
    const title = titleOf(r.body)!;
    expect(title.length).toBeLessThanOrEqual(60);
    expect(title.endsWith("…")).toBe(true);
    expect(title.startsWith("T".repeat(50))).toBe(true);
    const desc = metaContent(r.body, "name", "description")!;
    expect(desc).toBe("D".repeat(160));
  });

  // R142 (K-1): the clamp must be the MetaTags WORD-BOUNDARY algorithm,
  // not a raw character cut — the two LIVE money-page titles (61 chars,
  // both ending «… | SubNation») shipped mid-word shards («…| SubNat…»)
  // in the raw shell while the hydrated page clamped at the word
  // boundary (raw ≠ hydrated — the split-title signal R122 closed).
  it("R142 K-1: spaced over-long titles clamp at the WORD BOUNDARY — no mid-word shards (the two live money-page titles)", async () => {
    const [lifetimeRow] = await db
      .insert(productsTable)
      .values({
        name: "Lifetime Cloud Storage",
        slug: "lifetime-cloud-storage",
        price: "980.00",
        category: "software",
        seoTitle: "تخزين سحابي مدى الحياة — من 500 جيجا إلى بلا حدود | SubNation",
        description: "وصف",
        isActive: true,
      })
      .returning({ slug: productsTable.slug });
    const [hallmarkRow] = await db
      .insert(productsTable)
      .values({
        name: "Hallmark Movies Now",
        slug: "hallmark-movies-now",
        price: "60.00",
        category: "streaming",
        seoTitle: "اشتراك Hallmark — أفلام عائلية ورومانسية في ليبيا | SubNation",
        description: "وصف",
        isActive: true,
      })
      .returning({ slug: productsTable.slug });

    const lifetime = await get(`/product/${lifetimeRow.slug}`);
    const lifetimeTitle = titleOf(lifetime.body)!;
    expect(lifetimeTitle).toBe("تخزين سحابي مدى الحياة — من 500 جيجا إلى بلا حدود |…");
    // the raw-cut shard class ("…| SubNat…") must be gone
    expect(lifetimeTitle).not.toMatch(/SubN/);
    expect(metaContent(lifetime.body, "property", "og:title")).toBe(lifetimeTitle);

    const hallmark = await get(`/product/${hallmarkRow.slug}`);
    const hallmarkTitle = titleOf(hallmark.body)!;
    expect(hallmarkTitle).toBe("اشتراك Hallmark — أفلام عائلية ورومانسية في ليبيا |…");
    expect(hallmarkTitle).not.toMatch(/SubN/);
    for (const t of [lifetimeTitle, hallmarkTitle]) {
      expect(t.length).toBeLessThanOrEqual(60);
      expect(t.endsWith("…")).toBe(true);
    }
  });

  it("R122: whitespace-only seo overrides fall back to the defaults (trim, not truthiness)", async () => {
    const [seoRow] = await db
      .insert(productsTable)
      .values({
        name: "Fallback Product",
        slug: "fallback-seo-shell-test",
        description: "وصف المنتج للاختبار",
        price: "12.00",
        category: "tools",
        seoTitle: "   ",
        seoDescription: "",
        isActive: true,
      })
      .returning({ slug: productsTable.slug });

    const r = await get(`/product/${seoRow.slug}`);
    expect(titleOf(r.body)).toBe("Fallback Product — SubNation");
    expect(metaContent(r.body, "name", "description")).toContain("السعر 12.00 د.ل");
  });

  it("a numeric /product/:id request canonicalizes to the row's SLUG url", async () => {
    const r = await get(`/product/${activeProduct.id}`);
    expect(r.status).toBe(200);
    expect(canonicalHref(r.body)).toBe(`https://subnation.ly/product/${activeProduct.slug}`);
  });

  it("trailing slashes are normalized (no /category/vpn/ self-duplicate)", async () => {
    const r = await get("/category/vpn/");
    expect(canonicalHref(r.body)).toBe("https://subnation.ly/category/vpn");
  });
});

// ── A11-F3b (R126-L6): product shells ship the REAL art as og:image ────────

describe("SPA shell rewrite — product og:image (A11-F3b, R126-L6)", () => {
  it("a product with imageUrl rewrites og:image to the absolutized art URL and STRIPS the baseline og:image:width/height", async () => {
    // activeProduct ships imageUrl "/products/expressvpn.webp" (the
    // beforeEach seed) — site-relative, like production DB rows.
    const r = await get(`/product/${activeProduct.slug}`);
    expect(r.status).toBe(200);
    expect(metaContent(r.body, "property", "og:image")).toBe(
      // R174: bot-surface art URLs carry the art version — same cache-bust
      // contract as the frontend's productArtUrl (30d HTTP + SW caches).
      "https://subnation.ly/products/expressvpn.webp?v=r176",
    );
    // The 1280×720 pair describes the BASELINE opengraph.jpg — beside
    // product art it would be a wrong dimension claim, so it's stripped
    // (og:image without dimension tags is the shape the WhatsApp-proven
    // share-card route ships).
    expect(r.body).not.toContain('property="og:image:width"');
    expect(r.body).not.toContain('property="og:image:height"');
    // The rest of the og set survives untouched.
    expect(metaContent(r.body, "property", "og:title")).toBe(
      "ExpressVPN اشتراك اختبار — SubNation",
    );
    expect(canonicalHref(r.body)).toBe(`https://subnation.ly/product/${activeProduct.slug}`);
  });

  it("an already-absolute imageUrl passes through untouched (future CDN host)", async () => {
    const [cdnRow] = await db
      .insert(productsTable)
      .values({
        name: "CDN Product",
        slug: "cdn-image-shell-test",
        description: "وصف",
        price: "10.00",
        category: "tools",
        imageUrl: "https://cdn.example.net/art/x.webp",
        isActive: true,
      })
      .returning({ slug: productsTable.slug });

    const r = await get(`/product/${cdnRow.slug}`);
    expect(metaContent(r.body, "property", "og:image")).toBe("https://cdn.example.net/art/x.webp");
  });

  it("a product WITHOUT imageUrl keeps the static og set (a generic card beats none)", async () => {
    const [bareRow] = await db
      .insert(productsTable)
      .values({
        name: "Bare Product",
        slug: "bare-image-shell-test",
        description: "وصف",
        price: "10.00",
        category: "tools",
        imageUrl: null,
        isActive: true,
      })
      .returning({ slug: productsTable.slug });

    const r = await get(`/product/${bareRow.slug}`);
    expect(metaContent(r.body, "property", "og:image")).toBe("https://subnation.ly/opengraph.jpg");
    // …and the baseline dimensions stay (they describe that image).
    expect(r.body).toContain('property="og:image:width" content="1280"');
  });

  it("NON-product routes keep the static og set (the rewrite is product-scoped)", async () => {
    const r = await get("/category/vpn");
    expect(metaContent(r.body, "property", "og:image")).toBe("https://subnation.ly/opengraph.jpg");
    expect(r.body).toContain('property="og:image:width" content="1280"');
  });
});

// ── R142 (K-2): OG identity arms — og:url/og:type follow the canonical ──────

describe("SPA shell rewrite — og:url / og:type identity (R142 K-2)", () => {
  it("a PRODUCT shell advertises itself as the OG object: og:url = the product URL, og:type = product", async () => {
    const r = await get(`/product/${activeProduct.slug}`);
    expect(metaContent(r.body, "property", "og:url")).toBe(
      `https://subnation.ly/product/${activeProduct.slug}`,
    );
    expect(metaContent(r.body, "property", "og:type")).toBe("product");
    // …and the og:url now AGREES with the canonical (the pre-fix shell
    // said canonical=/product/x while og:url=the homepage).
    expect(canonicalHref(r.body)).toBe(`https://subnation.ly/product/${activeProduct.slug}`);
  });

  it("a numeric /product/:id shell canonicalizes og:url to the row's SLUG url too", async () => {
    const r = await get(`/product/${activeProduct.id}`);
    expect(metaContent(r.body, "property", "og:url")).toBe(
      `https://subnation.ly/product/${activeProduct.slug}`,
    );
  });

  it("a CATEGORY shell rewrites og:url to the category URL; og:type stays `website` (only the PDP is a product object)", async () => {
    const r = await get("/category/vpn");
    expect(metaContent(r.body, "property", "og:url")).toBe("https://subnation.ly/category/vpn");
    expect(metaContent(r.body, "property", "og:type")).toBe("website");
  });

  it("a STATIC route shell (flash-sales) rewrites og:url to the route URL", async () => {
    const r = await get("/flash-sales");
    expect(metaContent(r.body, "property", "og:url")).toBe("https://subnation.ly/flash-sales");
  });

  it('the HOME shell keeps the static baseline og identity (already correct for "/")', async () => {
    const r = await get("/");
    expect(metaContent(r.body, "property", "og:url")).toBe("https://subnation.ly/");
    expect(metaContent(r.body, "property", "og:type")).toBe("website");
  });

  it("noindex families keep the static og identity (never rewritten — the family is unindexable by design)", async () => {
    const r = await get("/login");
    expect(metaContent(r.body, "property", "og:url")).toBe("https://subnation.ly/");
    expect(metaContent(r.body, "property", "og:type")).toBe("website");
  });
});

// ── A7-F7: dead product slugs are a REAL 404 ────────────────────────────────

describe("SPA shell rewrite — dead product slugs answer 404 (A7-F7)", () => {
  it.each([
    ["unknown slug", () => `/product/never-existed`],
    ["inactive row", () => `/product/${inactiveProduct.slug}`],
    ["archived row", () => `/product/${archivedProduct.slug}`],
  ])("%s → 404 + the SPA shell (client-side 404 UX keeps rendering)", async (_name, url) => {
    const r = await get(url());
    expect(r.status).toBe(404);
    // The shell still ships — the SPA's not-found page renders client-side.
    expect(isSpaShell(r)).toBe(true);
    expect(r.contentType).toContain("text/html");
    // No canonical: a dead URL must not claim to be anything.
    expect(canonicalOf(r.body)).toBeNull();
    // R134 (A7-F6): the raw shell stamps noindex like the unknown-path
    // family (the SPA's own client-side 404 stamps the same) — the
    // raw/SPA pair no longer disagrees on the one 404 family.
    expect(metaContent(r.body, "name", "robots")).toBe("noindex,follow");
  });
});

// ── R163: the initial-HTML Product/Offer structured data ────────────────────

describe("SPA shell rewrite — PDP JSON-LD in the initial HTML (R163)", () => {
  /** Extract + JSON.parse every ld+json block the raw shell ships. */
  function ldBlocks(body: string): object[] {
    return [...body.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(
      (m) => JSON.parse(m[1] as string) as object,
    );
  }

  it("a live product's shell carries ONE parseable Product block whose Offer is honest about price + stock", async () => {
    const r = await get(`/product/${activeProduct.slug}`);
    expect(r.status).toBe(200);
    const blocks = ldBlocks(r.body);
    expect(blocks).toHaveLength(1);
    const ld = blocks[0] as Record<string, unknown>;
    expect(ld["@type"]).toBe("Product");
    // The @id/url node is the SAME one the hydrated page's JsonLd
    // re-emits (frontend buildProductLd) — the pair merges, never forks.
    expect(ld["@id"]).toBe("https://subnation.ly/product/expressvpn-shell-test");
    expect(ld.url).toBe("https://subnation.ly/product/expressvpn-shell-test");
    expect(ld.name).toBe("ExpressVPN اشتراك اختبار");
    expect(ld.sku).toBe("subnation-expressvpn-shell-test");
    expect(ld.brand).toEqual({ "@type": "Brand", name: "SubNation" });
    // Description preference mirrors the frontend builder.
    expect(ld.description).toBe("اشتراك VPN اختبار القشرة الثابتة");
    // Site-relative art is absolutized like og:image.
    expect(ld.image).toBe("https://subnation.ly/products/expressvpn.webp?v=r176");
    const offers = ld.offers as Record<string, unknown>;
    expect(offers.price).toBe("100.00");
    expect(offers.priceCurrency).toBe("LYD");
    expect(offers.itemCondition).toBe("https://schema.org/NewCondition");
    // R166 (F2): Offer.seller — Google's recommended field; SubNation IS
    // the seller (field-mirrored with the frontend buildProductLd Offer).
    expect(offers.seller).toEqual({ "@type": "Organization", name: "SubNation" });
    // R166 (F3): the raw category slug — schema-legal text the row
    // proves without importing the frontend categoryLabel map.
    expect(ld.category).toBe("vpn");
    // priceValidUntil: end of NEXT year (never an expired-offer signal).
    expect(offers.priceValidUntil).toBe(`${new Date().getUTCFullYear() + 1}-12-31`);
    expect(offers.url).toBe("https://subnation.ly/product/expressvpn-shell-test");
    // The seeded row has ZERO deliverable units → OutOfStock (the
    // D2-F2 honesty contract, now enforced pre-JS in the raw shell).
    expect(offers.availability).toBe("https://schema.org/OutOfStock");
  });

  it("a product with deliverable stock asserts InStock (ids forced to diverge — the correlation-where regression)", async () => {
    // Stock the active product with one deliverable unit (the catalog's
    // own is_available semantics: is_sold=false + a credential field).
    // R163 hardening: the correlated subquery once rendered
    // `"product_id" = "id"` (both names resolving against inventory),
    // which coincidentally PASSED while product.id == inventory.id —
    // so this test seeds 5 filler rows first, forcing the inventory
    // id ≠ product id, making any correlation regression FAIL loudly.
    for (let i = 0; i < 5; i += 1) {
      await db.insert(inventoryTable).values({
        productId: activeProduct.id,
        accountEmail: `filler-${i}@never-matching.example`,
        accountPassword: "filler",
        isSold: true, // sold filler rows never count as stock
      });
    }
    const [stockRow] = await db
      .insert(inventoryTable)
      .values({
        productId: activeProduct.id,
        accountEmail: "shell-ld-stock@example.com",
        accountPassword: "plainpass",
      })
      .returning({ id: inventoryTable.id });
    expect(stockRow.id, "the test's validity precondition: ids diverge").not.toBe(activeProduct.id);
    bumpCatalogCache();
    const r = await get(`/product/${activeProduct.slug}`);
    const blocks = ldBlocks(r.body);
    expect(blocks).toHaveLength(1);
    const offers = (blocks[0] as Record<string, unknown>).offers as Record<string, unknown>;
    expect(offers.availability).toBe("https://schema.org/InStock");
  });

  it("description_long is preferred over the short description (the frontend builder's rule)", async () => {
    await db
      .update(productsTable)
      .set({ descriptionLong: "الوصف الطويل الكامل للاختبار" })
      .where(eq(productsTable.id, activeProduct.id));
    bumpCatalogCache();
    const r = await get(`/product/${activeProduct.slug}`);
    const blocks = ldBlocks(r.body);
    expect(blocks).toHaveLength(1);
    expect((blocks[0] as Record<string, unknown>).description).toBe("الوصف الطويل الكامل للاختبار");
  });

  it("the HOME shell carries the Organization + WebSite LD pair (R166 F4)", async () => {
    const r = await get("/");
    expect(r.status).toBe(200);
    const blocks = ldBlocks(r.body);
    // Exactly the two static constants the hydrated home emits (the
    // ItemList stays client-only — it needs the loaded catalog).
    expect(blocks).toHaveLength(2);
    const org = blocks.find(
      (b) => (b as Record<string, unknown>)["@type"] === "Organization",
    ) as Record<string, unknown>;
    const site = blocks.find(
      (b) => (b as Record<string, unknown>)["@type"] === "WebSite",
    ) as Record<string, unknown>;
    expect(org).toBeDefined();
    expect(site).toBeDefined();
    // The exact JSON mirror of seo-builders' buildOrganizationLd() —
    // same @ids the hydrated page re-emits, so the pair merges.
    expect(org["@id"]).toBe("https://subnation.ly/#organization");
    expect(org.name).toBe("SubNation");
    expect(org.url).toBe("https://subnation.ly");
    expect(org.logo).toBe("https://subnation.ly/subnation-logo.png");
    expect((org.address as Record<string, unknown>).addressCountry).toBe("LY");
    expect((org.areaServed as Record<string, unknown>).name).toBe("Libya");
    expect(site["@id"]).toBe("https://subnation.ly/#website");
    expect(site.inLanguage).toBe("ar");
    expect((site.publisher as Record<string, unknown>)["@id"]).toBe(
      "https://subnation.ly/#organization",
    );
    const action = site.potentialAction as Record<string, unknown>;
    expect((action.target as Record<string, unknown>).urlTemplate).toBe(
      "https://subnation.ly/?search={search_term_string}",
    );
    expect(action["query-input"]).toBe("required name=search_term_string");
  });

  it("NON-product, NON-home, NON-category routes ship NO ld+json (statics, noindex families, unknowns)", async () => {
    for (const pathname of ["/flash-sales", "/support", "/terms", "/login", "/xyz-not-a-route"]) {
      const r = await get(pathname);
      expect(ldBlocks(r.body)).toHaveLength(0);
    }
  });

  it("category routes ship exactly the R177 pair (BreadcrumbList + CollectionPage)", async () => {
    const r = await get("/category/vpn");
    const blocks = ldBlocks(r.body) as Array<Record<string, unknown>>;
    expect(blocks).toHaveLength(2);
    expect(blocks.map((b) => b["@type"])).toEqual(["BreadcrumbList", "CollectionPage"]);
  });

  it("a dead product's 404 shell ships NO ld+json", async () => {
    const r = await get(`/product/${inactiveProduct.slug}`);
    expect(r.status).toBe(404);
    expect(ldBlocks(r.body)).toHaveLength(0);
  });
});

// ── R168 (L2): the shell Offer rides the cheapest AVAILABLE variant ────────

describe("SPA shell rewrite — PDP Offer price = the hydrated page's displayBase (R168 L2)", () => {
  /** Seed helper: a variant + its scoped deliverable inventory unit. */
  async function seedVariantWithStock(
    productId: number,
    opts: { plan: string | null; duration: string | null; price: string; stock: boolean },
  ) {
    const [v] = await db
      .insert(productVariantsTable)
      .values({
        productId,
        planLabel: opts.plan,
        durationLabel: opts.duration,
        costPrice: "10.00",
        priceLyd: opts.price,
        isActive: true,
      })
      .returning({ id: productVariantsTable.id });
    if (opts.stock) {
      // Scoped pool only (variant_id set, generic pool stays empty) so the
      // two-pool availability arms are exercised independently.
      await db.insert(inventoryTable).values({
        productId,
        variantId: v.id,
        accountEmail: "variant-stock@example.com",
        accountPassword: "plainpass",
      });
    }
    return v;
  }

  async function offersOf(slug: string): Promise<Record<string, unknown>> {
    const r = await get(`/product/${slug}`);
    expect(r.status).toBe(200);
    // Same extractor contract as the R163 block above (local scope there).
    const blocks = [
      ...r.body.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g),
    ].map((m) => JSON.parse(m[1] as string) as object);
    expect(blocks).toHaveLength(1);
    return (blocks[0] as Record<string, unknown>).offers as Record<string, unknown>;
  }

  it("a variant product whose base price ≠ cheapest-available variant → the Offer carries the VARIANT-derived price", async () => {
    // Base row says 500.00; the storefront renders the cheapest available
    // variant (79.80). Pre-R168 the shell's Offer said 500.00 while the
    // hydrated page's LD said 79.80 — two conflicting Offers under one @id.
    const [p] = await db
      .insert(productsTable)
      .values({
        name: "Variant Priced Product",
        slug: "variant-priced-shell-test",
        description: "وصف",
        price: "500.00",
        category: "streaming",
        isActive: true,
      })
      .returning({ id: productsTable.id, slug: productsTable.slug });
    await seedVariantWithStock(p.id, {
      plan: "أساسي",
      duration: "شهر واحد",
      price: "79.80",
      stock: true,
    });
    await seedVariantWithStock(p.id, {
      plan: "بريميوم",
      duration: "شهر واحد",
      price: "119.80",
      stock: true,
    });
    bumpCatalogCache();

    const offers = await offersOf(p.slug!);
    expect(offers.price).toBe("79.80");
    expect(offers.availability).toBe("https://schema.org/InStock");
  });

  it("the cheapest variant DRAINED (scoped pool empty, generic pool empty) → the Offer rides the next available variant", async () => {
    const [p] = await db
      .insert(productsTable)
      .values({
        name: "Drained Cheapest Product",
        slug: "drained-cheapest-shell-test",
        description: "وصف",
        price: "500.00",
        category: "streaming",
        isActive: true,
      })
      .returning({ id: productsTable.id, slug: productsTable.slug });
    // 79.80 exists as a row but holds NO deliverable stock anywhere →
    // unavailable (the R130 «تبدأ من» semantics the hydrated page rides).
    await seedVariantWithStock(p.id, {
      plan: "أساسي",
      duration: "شهر واحد",
      price: "79.80",
      stock: false,
    });
    await seedVariantWithStock(p.id, {
      plan: "بريميوم",
      duration: "شهر واحد",
      price: "119.80",
      stock: true,
    });
    bumpCatalogCache();

    const offers = await offersOf(p.slug!);
    expect(offers.price).toBe("119.80");
    expect(offers.availability).toBe("https://schema.org/InStock");
  });

  it("a tierless product (no variants at all) keeps the base row price", async () => {
    const [p] = await db
      .insert(productsTable)
      .values({
        name: "Tierless Product",
        slug: "tierless-price-shell-test",
        description: "وصف",
        price: "123.45",
        category: "tools",
        isActive: true,
      })
      .returning({ id: productsTable.id, slug: productsTable.slug });
    bumpCatalogCache();

    const offers = await offersOf(p.slug!);
    expect(offers.price).toBe("123.45");
  });

  it("ALL variants sold out → OutOfStock + the product base price (no fabricated variant claim)", async () => {
    const [p] = await db
      .insert(productsTable)
      .values({
        name: "All Drained Product",
        slug: "all-drained-shell-test",
        description: "وصف",
        price: "100.00",
        category: "streaming",
        isActive: true,
      })
      .returning({ id: productsTable.id, slug: productsTable.slug });
    await seedVariantWithStock(p.id, {
      plan: "أساسي",
      duration: "شهر واحد",
      price: "79.80",
      stock: false,
    });
    await seedVariantWithStock(p.id, {
      plan: "بريميوم",
      duration: "شهر واحد",
      price: "119.80",
      stock: false,
    });
    bumpCatalogCache();

    const offers = await offersOf(p.slug!);
    expect(offers.availability).toBe("https://schema.org/OutOfStock");
    // No variant is available → the base row price, never a stale
    // availability-blind variant minimum.
    expect(offers.price).toBe("100.00");
  });

  it("a GENERIC-pool unit makes every active variant available (the two-pool arm) — cheapest active variant wins", async () => {
    const [p] = await db
      .insert(productsTable)
      .values({
        name: "Generic Pool Product",
        slug: "generic-pool-shell-test",
        description: "وصف",
        price: "500.00",
        category: "streaming",
        isActive: true,
      })
      .returning({ id: productsTable.id, slug: productsTable.slug });
    await seedVariantWithStock(p.id, {
      plan: "أساسي",
      duration: "شهر واحد",
      price: "79.80",
      stock: false,
    });
    // One GENERIC (variant_id NULL) deliverable unit → both variants are
    // buyable → the cheapest ACTIVE variant's price drives the Offer.
    await db.insert(inventoryTable).values({
      productId: p.id,
      variantId: null,
      accountEmail: "generic-pool@example.com",
      accountPassword: "plainpass",
    });
    bumpCatalogCache();

    const offers = await offersOf(p.slug!);
    expect(offers.price).toBe("79.80");
    expect(offers.availability).toBe("https://schema.org/InStock");
  });
});

// ── A7-F16: auth/transactional/admin families get noindex in RAW html ──────

describe("SPA shell rewrite — noindex families in the raw shell (A7-F16)", () => {
  it.each([
    ["/login", "/login"],
    ["/register", "/register"],
    ["/forgot-password", "/forgot-password"],
    ["/onboarding", "/onboarding"],
    ["/auth/telegram-callback", "/auth/telegram-callback"],
    ["/cart", "/cart"],
    ["/checkout", "/checkout"],
    ["/wallet", "/wallet"],
    ["/orders", "/orders"],
    ["/orders/123", "/orders/123"],
    ["/loyalty", "/loyalty"],
    ["/referrals", "/referrals"],
    ["/profile", "/profile"],
    ["/admin", "/admin"],
    ["/admin/users", "/admin/users"],
    ["/status", "/status"],
    // R142 (K-3): the 7 previously-unpinned families — deleting any
    // SHELL_NOINDEX_RES line used to pass CI while robots.txt and the
    // SPA's NOINDEX_ROUTES kept walling the family (the r140-m
    // /notifications class, re-openable by a one-line edit).
    ["/notifications", "/notifications"],
    ["/notifications?page=2", "/notifications?page=2"],
  ])(
    "%s → noindex,follow + canonical stripped (index,follow NEVER in raw HTML)",
    async (label, url) => {
      const r = await get(url);
      expect(r.status).toBe(200);
      expect(isSpaShell(r)).toBe(true);
      expect(metaContent(r.body, "name", "robots")).toBe("noindex,follow");
      // A noindex page must not point a canonical at the homepage — that
      // combination is a self-contradiction (canonical says "index the
      // homepage instead", robots says "index nothing").
      expect(canonicalOf(r.body)).toBeNull();
      expect(label).toBe(url);
    },
  );
});

// ── R176: no-JS fallback H1 + internal-link nav ────────────────────────────

describe("SPA shell rewrite — no-JS fallback H1 + internal links (R176)", () => {
  it("home ships the keyword H1, the meta description and every live category link", async () => {
    const r = await get("/");
    expect(r.status).toBe(200);
    expect(r.body).toContain('<noscript data-seo-nav="1">');
    expect(r.body).toContain(">سوق الاشتراكات الرقمية في ليبيا</h1>");
    expect(r.body).toContain('href="https://subnation.ly/" aria-current="page"');
    expect(r.body).toContain('href="https://subnation.ly/category/streaming"');
    expect(r.body).toContain('href="https://subnation.ly/category/software"');
    expect(r.body).toContain('href="https://subnation.ly/support"');
    expect(r.body).toContain('href="https://subnation.ly/sitemap.xml"');
  });

  it("category shell ships its pinned h1 + the current-category marker", async () => {
    const r = await get("/category/vpn");
    expect(r.body).toContain(">اشتراكات VPN في ليبيا</h1>");
    expect(r.body).toContain('href="https://subnation.ly/category/vpn" aria-current="page"');
    // Every fallback link is an absolute canonical-origin URL.
    expect(r.body).toContain('href="https://subnation.ly/category/education"');
  });

  it("product shell uses the Product-LD name as the fallback H1 (unclamped)", async () => {
    const r = await get(`/product/${activeProduct.slug}`);
    expect(r.body).toContain(">ExpressVPN اشتراك اختبار</h1>");
  });

  it("noindex/404 shells never ship the fallback nav", async () => {
    const unknown = await get("/some-unknown-page");
    expect(unknown.body).not.toContain('data-seo-nav="1"');
    const dead = await get("/product/does-not-exist");
    expect(dead.body).not.toContain('data-seo-nav="1"');
    const retired = await get("/category/gaming");
    expect(retired.body).not.toContain('data-seo-nav="1"');
  });

  it("301s the retired productivity category to its live software successor", async () => {
    const r = await get("/category/productivity", UA_BROWSER, "manual");
    expect(r.status).toBe(301);
    expect(r.location).toContain("/category/software");
  });
});

// ── Unknown paths: no canonical, noindex (R122 A7-P1-2) ───────────────────

describe("SPA shell rewrite — unknown public paths (no lying canonical, noindex)", () => {
  it("an unknown path keeps the 200 shell (SPA 404 UX) but DROPS the homepage canonical + stamps noindex (R122 A7-P1-2)", async () => {
    const r = await get("/some-unknown-page");
    expect(r.status).toBe(200);
    expect(isSpaShell(r)).toBe(true);
    expect(canonicalOf(r.body)).toBeNull();
    // R122 (A7-P1-2): the SPA renders its own noindex 404 surface for
    // exactly these URLs (not-found.tsx) — the raw shell used to keep
    // the static index,follow and contradict it for every non-rendering
    // engine. Title stays the baseline; the client owns the 404 UX.
    expect(titleOf(r.body)).toBe("SubNation — سوق الاشتراكات الرقمية");
    expect(metaContent(r.body, "name", "robots")).toBe("noindex,follow");
  });

  it("an unknown/retired category slug serves a REAL 404 + no canonical + noindex (R163 soft-404 fix — the shell still ships for the client-side 404 UX)", async () => {
    const r = await get("/category/gaming");
    // R163: mirrors the unknown-product branch — Google's soft-404
    // guidance + the live evidence (the retired /category/gaming had been
    // indexed as an error page under the old 200 status).
    expect(r.status).toBe(404);
    expect(canonicalOf(r.body)).toBeNull();
    expect(titleOf(r.body)).toBe("SubNation — سوق الاشتراكات الرقمية");
    expect(metaContent(r.body, "name", "robots")).toBe("noindex,follow");
    // The SPA still boots from this shell (the client-side 404 UI is a
    // rendered surface, not an empty body).
    expect(r.body).toContain('<div id="root">');
  });

  it("KNOWN routes stay index,follow (the noindex stamp never over-reaches)", async () => {
    const r = await get("/category/vpn");
    expect(metaContent(r.body, "name", "robots")).toBe("index,follow");
    expect(canonicalHref(r.body)).toBe("https://subnation.ly/category/vpn");
  });
});

// ── Cache/header sanity: the rewrite layer must not alter shell caching ─────

describe("SPA shell rewrite — response headers unchanged", () => {
  it("rewritten shells keep the no-store + html content-type the SPA always had", async () => {
    const r = await get("/category/vpn");
    expect(r.cacheControl).toContain("no-store");
    expect(r.contentType).toContain("text/html");
  });
});

// ── R122 (A3-P1): the /product/* shell lookup rides the catalog cache ───────

describe("SPA shell product lookup — catalog-cache contract (R122 A3-P1)", () => {
  it("a repeat GET serves the CACHED meta for 60 s; bumpCatalogCache() (admin CRUD) refreshes it", async () => {
    const slug = activeProduct.slug;
    // Prime the cache.
    const first = await get(`/product/${slug}`);
    expect(titleOf(first.body)).toBe("ExpressVPN اشتراك اختبار — SubNation");

    // Direct DB edit (no bump) — the cached shell meta must NOT change
    // within the TTL: this pins that the cache actually exists (without
    // it, every GET re-queried and the edit would leak through instantly).
    await db
      .update(productsTable)
      .set({ name: "اسم جديد بعد التخزين المؤقت", seoTitle: "عنوان SEO جديد" })
      .where(eq(productsTable.id, activeProduct.id));
    const stale = await get(`/product/${slug}`);
    expect(titleOf(stale.body)).toBe("ExpressVPN اشتراك اختبار — SubNation");

    // The admin-CRUD invalidation hook (bumpCatalogCache is what the
    // admin product routes call) orphans the entry → fresh meta.
    bumpCatalogCache();
    const fresh = await get(`/product/${slug}`);
    expect(titleOf(fresh.body)).toBe("عنوان SEO جديد");
  });

  it("an over-160-char slug 404s without a query (varchar(160) can never match — the by-slug route's guard)", async () => {
    const r = await get(`/product/${"x".repeat(161)}`);
    expect(r.status).toBe(404);
    expect(isSpaShell(r)).toBe(true);
    expect(canonicalOf(r.body)).toBeNull();
  });
});

// ── A7-F9 + A7-F17: the flash-sale price rides BOTH share surfaces ─────────

describe("share price + description budget (A7-F9 + A7-F17)", () => {
  it("an active flash sale drives the shell description price (list 100 → 25% → 75.00)", async () => {
    await db.insert(flashSalesTable).values({
      title: "عرض الاختبار",
      discountPercent: "25.00",
      endsAt: new Date(Date.now() + 60 * 60 * 1000),
      isActive: true,
    });

    const r = await get(`/product/${activeProduct.slug}`);
    expect(r.status).toBe(200);
    const desc = metaContent(r.body, "name", "description");
    // The flash-sale price — not the list price.
    expect(desc).toContain("السعر 75.00 د.ل");
    expect(desc).not.toContain("السعر 100.00");
    expect(desc!.length).toBeLessThanOrEqual(180);
  });

  it("a 300-char description still lands inside the 180-char share budget", async () => {
    await db
      .update(productsTable)
      .set({ description: "ك".repeat(300) })
      .where(eq(productsTable.id, activeProduct.id));

    const r = await get(`/product/${activeProduct.slug}`);
    const desc = metaContent(r.body, "name", "description");
    // 150-char body slice + " — السعر 100.00 د.ل" suffix, assembled ≤ 180
    // (the OLD slice(0,180) + suffix could overshoot the budget).
    expect(desc!.length).toBeLessThanOrEqual(180);
    expect(desc!.startsWith("ك".repeat(150))).toBe(true);
    expect(desc).toContain("السعر 100.00 د.ل");
  });
});

// ── Unit: a marker-less shell passes through byte-identical ─────────────────

describe("applySpaShellMeta — marker-less shells pass through (safety)", () => {
  it("a shell without the rewrite markers passes its meta/canonical through UNTOUCHED (stub shells, older deploys)", () => {
    // No <title>, no meta[name/property], no canonical link — nothing
    // for the rewrite to act on (a <title> WOULD be rewritten: it needs
    // no marker, every HTML document has one).
    const bare = `<!DOCTYPE html><html><head></head><body>Y</body></html>`;
    expect(
      appModule.applySpaShellMeta(bare, {
        status: 200,
        title: "T",
        description: "D",
        canonical: "https://subnation.ly/c",
        robots: "noindex,follow",
      }),
    ).toBe(bare);
  });
});

// ── A8-F3: the minimal zod-issues client shape ──────────────────────────────

describe("zodIssuesToClient — minimal { path, code } pairs only (A8-F3)", () => {
  it("maps issues to path+code and leaks NO message/received detail", () => {
    const mapped = appModule.zodIssuesToClient([
      {
        path: ["variants", 0, "price"],
        code: "too_small",
        // The fields below are what the OLD shape echoed verbatim — they
        // must not survive the mapping (parser internals as API surface).
        message: "Number must be ≥ 0.01",
        received: -5,
      },
    ] as unknown as Parameters<typeof appModule.zodIssuesToClient>[0]);

    expect(mapped).toEqual([{ path: "variants.0.price", code: "too_small" }]);
  });

  it("an empty issue list maps to an empty array (shape stays stable)", () => {
    expect(appModule.zodIssuesToClient([])).toEqual([]);
  });
});

// ── R120 hotfix: comment immunity ───────────────────────────────────────────

describe("applySpaShellMeta — comments that MENTION tags in prose (R120 hotfix)", () => {
  // The REAL production shell (frontend/dist/public/index.html) carries the
  // V3-A1 developer note ~2.6 KB before the real <title data-rh> tag:
  //
  //   <!-- MetaTags upsert-by-selector — one <title>, one
  //        description, one og set — so no duplicates ever ship (V3-A1:
  //        react-helmet tripled titles) -->
  //
  // The first shell-rewrite cut paired the COMMENT's "<title>" opener with
  // the REAL title's closer and replaced the whole span: the canonical
  // link and every og:/twitter: tag between them was deleted and the
  // comment was left UNCLOSED (9 `<!--` vs 8 `-->` on /category/*). These
  // tests pin the fixed contract: rewrites see markup, never comment prose.
  const SHELL_WITH_TAG_MENTION_COMMENTS = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<!-- MetaTags upsert-by-selector — one <title>, one
     description, one og set — so no duplicates ever ship (V3-A1:
     react-helmet tripled titles) -->
<link rel="canonical" href="https://subnation.ly/">
<meta property="og:title" content="BASELINE OG TITLE">
<meta property="og:description" content="BASELINE OG DESCRIPTION">
<meta name="description" content="BASELINE DESCRIPTION">
<title data-rh="true">SubNation — سوق الاشتراكات الرقمية</title>
</head>
<body><div id="root"></div></body>
</html>`;

  it("rewrites the REAL title and leaves the comment + canonical + og tags intact", () => {
    // R161-C: the fixture title rides the new streaming vocabulary
    // («اشتراكات منصات المشاهدة» — the honest on-demand-platforms
    // label; the old live-broadcast misnomer is retired).
    const out = appModule.applySpaShellMeta(SHELL_WITH_TAG_MENTION_COMMENTS, {
      status: 200,
      title: "اشتراكات منصات المشاهدة",
      description: "وصف الفئة",
      canonical: "https://subnation.ly/category/streaming",
    });
    // The REAL title rewritten…
    expect(out).toContain('<title data-rh="true">اشتراكات منصات المشاهدة</title>');
    // …the canonical REWRITTEN (was: deleted by the comment-pairing bug)…
    expect(out).toContain('rel="canonical" href="https://subnation.ly/category/streaming"');
    // …og tags rewritten in place…
    expect(out).toContain('property="og:title" content="اشتراكات منصات المشاهدة"');
    // …and the comment text survives VERBATIM (uncut, still closed).
    expect(out).toContain("one <title>, one");
    expect(out).toContain("-->");
    const opens = (out.match(/<!--/g) ?? []).length;
    const closes = (out.match(/-->/g) ?? []).length;
    expect(opens).toBe(closes);
  });

  it("a comment mentioning <link rel=canonical> prose cannot shield the real canonical from STRIPPING", () => {
    const shell = `<!DOCTYPE html><html><head>
<!-- devs: keep exactly one <link rel="canonical" href="..."> in the head -->
<link rel="canonical" href="https://subnation.ly/">
<title>X</title></head><body></body></html>`;
    const out = appModule.applySpaShellMeta(shell, { status: 200, canonical: null });
    // The REAL canonical is gone…
    expect(out).not.toContain('<link rel="canonical" href="https://subnation.ly/">');
    // …but the comment prose survives untouched.
    expect(out).toContain('one <link rel="canonical" href="..."> in the head');
  });

  it("the noindex stamp cannot be fooled by a comment quoting the robots meta either", () => {
    const shell = `<!-- note: <meta name="robots" content="index,follow"> is the shell default -->
<meta name="robots" content="index,follow">
<title>X</title>`;
    const out = appModule.applySpaShellMeta(shell, { status: 200, robots: "noindex,follow" });
    expect(out).toContain('<meta name="robots" content="noindex,follow">');
    // Exactly ONE noindex stamp — the comment's quote stays as prose.
    expect(out.match(/noindex,follow/g)?.length).toBe(1);
  });
});
