import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Express } from "express";
import { eq } from "drizzle-orm";
import { db, initTestDb, productsTable, resetTestDb, flashSalesTable } from "../test/db";

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
    // The category map's meta (NOT the homepage baseline).
    expect(titleOf(r.body)).toBe("اشتراكات VPN في ليبيا — ExpressVPN و CyberGhost و IPVanish");
    expect(metaContent(r.body, "name", "description")).toContain("ExpressVPN");
    expect(metaContent(r.body, "property", "og:title")).toBe(
      "اشتراكات VPN في ليبيا — ExpressVPN و CyberGhost و IPVanish",
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

// ── Unknown paths: no canonical at all ──────────────────────────────────────

describe("SPA shell rewrite — unknown public paths (no lying canonical)", () => {
  it("an unknown path keeps the 200 shell (SPA 404 UX) but DROPS the homepage canonical", async () => {
    const r = await get("/some-unknown-page");
    expect(r.status).toBe(200);
    expect(isSpaShell(r)).toBe(true);
    expect(canonicalOf(r.body)).toBeNull();
    // Title/robots stay the baseline — the client owns the 404 UX.
    expect(titleOf(r.body)).toBe("SubNation — سوق الاشتراكات الرقمية");
    expect(metaContent(r.body, "name", "robots")).toBe("index,follow");
  });

  it("an unknown category slug keeps 200 + no canonical (SPA noindex surface)", async () => {
    const r = await get("/category/gaming");
    expect(r.status).toBe(200);
    expect(canonicalOf(r.body)).toBeNull();
    expect(titleOf(r.body)).toBe("SubNation — سوق الاشتراكات الرقمية");
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
