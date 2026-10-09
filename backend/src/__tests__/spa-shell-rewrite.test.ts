import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Express } from "express";
import { eq } from "drizzle-orm";
import { db, initTestDb, productsTable, resetTestDb, flashSalesTable } from "../test/db";
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
 *          /terms get their REAL canonical + title + description;
 *          / stays byte-identical.
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
}

async function get(pathname: string, userAgent = UA_BROWSER): Promise<ShellResponse> {
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
  it("/ stays BYTE-IDENTICAL to the shipped shell (the homepage meta is already correct)", async () => {
    const r = await get("/");
    expect(r.status).toBe(200);
    expect(r.body).toBe(SPA_STUB_HTML);
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
  });

  it("/flash-sales, /support and /terms get their static per-route meta", async () => {
    const flash = await get("/flash-sales");
    expect(titleOf(flash.body)).toBe("عروض فلاش — SubNation");
    expect(canonicalHref(flash.body)).toBe("https://subnation.ly/flash-sales");

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
  });
});

// ── A7-F16: auth/transactional/admin families get noindex in RAW html ──────

describe("SPA shell rewrite — noindex families in the raw shell (A7-F16)", () => {
  it.each([
    ["/login", "/login"],
    ["/register", "/register"],
    ["/cart", "/cart"],
    ["/checkout", "/checkout"],
    ["/wallet", "/wallet"],
    ["/orders", "/orders"],
    ["/orders/123", "/orders/123"],
    ["/profile", "/profile"],
    ["/admin", "/admin"],
    ["/admin/users", "/admin/users"],
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

  it("an unknown category slug keeps 200 + no canonical + noindex (SPA noindex surface, R122 A7-P1-2)", async () => {
    const r = await get("/category/gaming");
    expect(r.status).toBe(200);
    expect(canonicalOf(r.body)).toBeNull();
    expect(titleOf(r.body)).toBe("SubNation — سوق الاشتراكات الرقمية");
    expect(metaContent(r.body, "name", "robots")).toBe("noindex,follow");
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
    const out = appModule.applySpaShellMeta(SHELL_WITH_TAG_MENTION_COMMENTS, {
      status: 200,
      title: "اشتراكات البث المباشر",
      description: "وصف الفئة",
      canonical: "https://subnation.ly/category/streaming",
    });
    // The REAL title rewritten…
    expect(out).toContain('<title data-rh="true">اشتراكات البث المباشر</title>');
    // …the canonical REWRITTEN (was: deleted by the comment-pairing bug)…
    expect(out).toContain('rel="canonical" href="https://subnation.ly/category/streaming"');
    // …og tags rewritten in place…
    expect(out).toContain('property="og:title" content="اشتراكات البث المباشر"');
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
