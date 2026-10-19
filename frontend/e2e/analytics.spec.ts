import { test, expect } from "@playwright/test";

test.skip(!process.env.E2E_ENABLED, "E2E_ENABLED not set — smoke suite is opt-in");

/**
 * R168 — the GA4 activation surface (the R164 loader, verified live),
 * probed at the browser level. The scope is deliberately narrow:
 *
 *   1. the gtag.js script for the production tag loads (200) and the
 *      loader's `config` entry lands on window.dataLayer;
 *   2. SPA navigation rides GA4 Enhanced Measurement — a
 *      `gtm.historyChange` entry appears — and the app pushes NO
 *      manual `page_view` (the no-duplicates contract: EM already
 *      emits the history-based page_view, so an app-side push would
 *      double-count every route).
 *
 * The R168 ecommerce events themselves are unit-pinned on the
 * dataLayer push contract (src/lib/__tests__/analytics-events.test.ts)
 * — automated browsers get zero collect beacons (gtag.js
 * anti-automation suppression, verified in the round's live probe),
 * so beacon transmission is not assertable here and is left to the
 * operator's post-deploy GA4 Realtime check.
 *
 * Gating mirrors seo.spec.ts: E2E_ENABLED opt-in, E2E_BASE_URL target
 * (default the local compose stack — point it at the deployed surface
 * that carries VITE_GA_TRACKING_ID).
 */

test.describe("GA4 (R168) — loader + Enhanced Measurement", () => {
  test("homepage: gtag.js for G-RKRV3ZC3MF loads 200 and the config entry reaches dataLayer", async ({
    page,
  }) => {
    const gtagResponse = page.waitForResponse(
      (res) =>
        res.url().startsWith("https://www.googletagmanager.com/gtag/js") &&
        res.url().includes("id=G-RKRV3ZC3MF"),
    );
    await page.goto("/");
    const res = await gtagResponse;
    expect(res.status()).toBe(200);

    // The loader's config command is buffered on window.dataLayer
    // (the app-side contract — the loader sets dataLayer + gtag
    // before the script attaches).
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const layer = (window as { dataLayer?: unknown[] }).dataLayer ?? [];
          return layer.some(
            (entry) => Array.isArray(entry) && entry[0] === "config" && entry[1] === "G-RKRV3ZC3MF",
          );
        }),
      )
      .toBe(true);
  });

  test("SPA navigation: gtm.historyChange lands (EM active) and NO manual page_view is pushed", async ({
    page,
    request,
  }) => {
    // Ground truth first (the seo.spec.ts idiom): a real product slug.
    const list = await request.get("/api/products");
    expect(list.status()).toBe(200);
    const products = (await list.json()) as Array<{ slug: string }>;
    expect(products.length).toBeGreaterThan(0);
    const pick = products.find((p) => p.slug === "netflix-premium") ?? products[0]!;

    await page.goto("/");
    // The loader runs from requestIdleCallback — wait for it to arm.
    await page.waitForFunction(() => typeof (window as { gtag?: unknown }).gtag === "function");
    await page.locator(`a[href="/product/${pick.slug}"]`).first().click();

    // Enhanced Measurement reacts to the history change... (live-verified
    // shape: EM's history listener pushes OBJECT-form entries named
    // "gtm.historyChange-v2" — array-form entries are app-side gtag()
    // calls, e.g. the R168 view_item/view_item_list pushes.)
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const layer = (window as { dataLayer?: unknown[] }).dataLayer ?? [];
          return layer.some(
            (entry) =>
              !!entry &&
              typeof entry === "object" &&
              !Array.isArray(entry) &&
              String((entry as { event?: unknown }).event ?? "").startsWith("gtm.historyChange"),
          );
        }),
      )
      .toBe(true);

    // ...and the app itself must never push a manual page_view (the
    // no-duplicates contract — EM owns page_views on this SPA; an app
    // push would go through window.gtag, i.e. ARRAY form — EM itself
    // never echoes page_view onto the dataLayer, so the array check is
    // the precise app-side contract).
    const manualPageView = await page.evaluate(() => {
      const layer = (window as { dataLayer?: unknown[] }).dataLayer ?? [];
      return layer.some(
        (entry) => Array.isArray(entry) && entry[0] === "event" && entry[1] === "page_view",
      );
    });
    expect(manualPageView).toBe(false);
  });
});
