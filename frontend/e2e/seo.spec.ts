import { test, expect } from "@playwright/test";

test.skip(!process.env.E2E_ENABLED, "E2E_ENABLED not set — smoke suite is opt-in");

/**
 * R163 — the SEO surface contract, verified against the REAL deployed site
 * (read-only GETs only; this spec is the post-deploy behavior probe for the
 * round's robots/sitemap/shell-structured-data changes).
 *
 * Deploy-race discipline (the R161 soldout-pdp idiom): every assertion on
 * NEW behavior feature-detects first and `test.skip`s LOUDLY when the
 * live surface still runs the previous deployment — a CI run racing the
 * Coolify webhook must never fail on code that is merged but not yet
 * deployed, and must never silently pass as if it had verified it.
 */

test.describe("SEO shells — robots, sitemap, 404 shape", () => {
  test("robots.txt advertises the sitemap", async ({ request }) => {
    const res = await request.get("/robots.txt");
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain("Sitemap:");
    expect(body).toContain("/sitemap.xml");
  });

  test("sitemap.xml lists product URLs on the canonical origin, no hreflang noise", async ({
    request,
  }) => {
    const res = await request.get("/sitemap.xml");
    expect(res.status()).toBe(200);
    const xml = await res.text();
    expect(xml).toContain("<loc>");
    expect(xml).toContain("/product/");
    // R163: single-language site — the redundant same-URL hreflang/x-default
    // alternates were removed. Pin their absence (deploy-race-safe: only
    // assert when the new build is live).
    if (!xml.includes('hreflang="ar"')) {
      expect(xml).not.toContain("xhtml:link");
      expect(xml).not.toContain("xmlns:xhtml");
    } else {
      test.skip(
        true,
        "live sitemap still carries the pre-R163 hreflang alternates — deploy not live yet",
      );
    }
    // Absolute canonical URLs only (the sitemap must never leak a
    // relative or foreign-origin loc).
    for (const loc of [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1] as string)) {
      expect(loc.startsWith("https://")).toBe(true);
    }
  });

  test("an unknown path serves the noindex shell + client 404 UI", async ({ page }) => {
    const response = await page.goto("/xyz-r163-e2e-unknown");
    expect(response?.status()).toBe(200); // SPA shell
    const robots = await page.locator('meta[name="robots"], meta[name="ROBOTS"]').first();
    await expect(robots).toHaveAttribute("content", /noindex/i, { timeout: 15_000 });
    await expect(page.getByText(/غير موجودة|404/).first()).toBeVisible({ timeout: 15_000 });
  });

  test("an unknown/retired CATEGORY slug answers a REAL 404 (R163 soft-404 fix)", async ({
    request,
  }) => {
    const res = await request.get("/category/gaming-r163-e2e");
    if (res.status() === 404) {
      // The R163 deployment is live: unknown categories 404 like unknown
      // products (Google's soft-404 guidance), with the SPA still
      // bootable from the body.
      const body = await res.text();
      expect(body).toContain('id="root"');
    } else if (res.status() === 200) {
      test.skip(true, "live shell still 200s unknown categories — the R163 deploy is not live yet");
    } else {
      throw new Error(`unexpected status ${res.status()} for an unknown category`);
    }
  });

  test("the noindex customer families are CRAWLABLE (their noindex stays readable)", async ({
    request,
  }) => {
    const res = await request.get("/robots.txt");
    expect(res.status()).toBe(200);
    const body = await res.text();
    // R163 inversion: the auth/funnel/user-private families dropped their
    // robots walls so crawlers can read the noindex,follow these pages
    // serve. Only the documented walls (/api/, /admin, /status) remain.
    const disallowLines = body
      .split("\n")
      .filter((l) => l.startsWith("Disallow: "))
      .map((l) => l.slice("Disallow: ".length));
    if (!disallowLines.includes("/login")) {
      // New design live: exactly the documented walls, nothing else.
      const walls = ["/api/", "/admin", "/admin/", "/status"];
      for (const d of disallowLines) {
        expect(walls, `unexpected Disallow line ${d} outside the documented walls`).toContain(d);
      }
    } else {
      test.skip(true, "live robots.txt still carries the pre-R163 walls — deploy not live yet");
    }
  });
});

test.describe("SEO — the PDP crawler shell's structured data (R163)", () => {
  test("a live product's initial HTML carries a parseable Product JSON-LD whose Offer matches the API", async ({
    request,
  }) => {
    // Ground truth first: the same public DTO the page hydrates from.
    const list = await request.get("/api/products");
    expect(list.status()).toBe(200);
    const products = (await list.json()) as Array<{ slug: string; name: string }>;
    expect(products.length).toBeGreaterThan(0);
    const pick = products.find((p) => p.slug === "netflix-premium") ?? products[0]!;

    // The crawler-shell HTML (no JS execution — a plain request context).
    const res = await request.get(`/product/${pick.slug}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      },
    });
    expect(res.status()).toBe(200);
    const html = await res.text();
    const blocks = [
      ...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g),
    ].map((m) => m[1] as string);
    if (blocks.length === 0) {
      test.skip(true, "live PDP shell carries no ld+json yet — the R163 deploy is not live");
    } else {
      expect(blocks.length).toBeGreaterThanOrEqual(1);
      const ld = JSON.parse(blocks[0]!) as Record<string, unknown>;
      expect(ld["@type"]).toBe("Product");
      // @id/url: the canonical product URL (same node the hydrated page
      // re-emits — merged, never forked).
      expect(ld["@id"]).toBe(`https://subnation.ly/product/${pick.slug}`);
      expect(ld.url).toBe(`https://subnation.ly/product/${pick.slug}`);
      expect(ld.name).toBe(pick.name);
      const offers = ld.offers as Record<string, unknown>;
      expect(offers.priceCurrency).toBe("LYD");
      expect(typeof offers.price).toBe("string");
      expect(offers.itemCondition).toBe("https://schema.org/NewCondition");
      // Price: the shell LD rides the flash-aware product price — it must
      // equal the list price OR the active sale price, 2-dp formatted.
      const detail = await request.get(`/api/products/by-slug/${pick.slug}`);
      const dto = (await detail.json()) as {
        is_available?: boolean;
        price?: number;
        sale_price?: number | null;
      };
      const lawful = new Set(
        [dto.price, dto.sale_price]
          .filter((v): v is number => typeof v === "number")
          .map((v) => v.toFixed(2)),
      );
      expect(
        lawful.has(String(offers.price)),
        `LD price ${String(offers.price)} matches the API offer`,
      ).toBe(true);
      // Availability: honest against the API's own stock signal.
      expect(offers.availability).toBe(
        dto.is_available === true ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      );
      // No fabricated social proof, ever (the r140-g pin, now pinned at the
      // raw-HTML surface too).
      expect(ld.aggregateRating).toBeUndefined();
      expect(ld.reviewCount).toBeUndefined();
    }
  });
});
