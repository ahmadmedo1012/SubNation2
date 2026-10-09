import { test, expect } from "@playwright/test";

test.skip(!process.env.E2E_ENABLED, "E2E_ENABLED not set — smoke suite is opt-in");

/**
 * R126-L7 (A10 §2.2 P2-2 / §4): rubbergreen repair. The old assertions
 * could false-pass while search silently no-op'd:
 *   - the nav-timeout swallow `.catch(() => {})` hid a spec that expected
 *     a route change — but home search is CLIENT-side filtering
 *     (home.tsx commitSearch → useListProducts(?search=) + a
 *     replaceState URL mirror — no navigation ever happens);
 *   - the pass-any-product-link disjunction (`netflix visible || any
 *     /product/ link`) is satisfied by the UNFILTERED home grid;
 *   - the "garbage query" test never asserted the empty state at all.
 *
 * The honest pins below: API ground truth first (api-contracts pattern),
 * then the URL mirror (the only observable commit), then the DOM must
 * surface exactly what the API said matched — or the exact empty-state
 * strings for the no-match query.
 */

test.describe("arabic search — the R122 normalization contract, live DOM", () => {
  test("«نتفليكس» filters the catalog grid to the matching product", async ({ page, request }) => {
    // Ground truth: what does the API say matches «نتفليكس»? The DOM
    // assertions must surface exactly this — the unfiltered home grid
    // can no longer satisfy them.
    const api = await request.get(`/api/products?search=${encodeURIComponent("نتفليكس")}`);
    expect(api.status(), "GET /api/products?search=نتفليكس must be 200").toBe(200);
    const matches = (await api.json()) as Array<{ name: string }>;
    expect(
      matches.length,
      "live catalog must carry a Netflix product for the arabic-search contract",
    ).toBeGreaterThan(0);

    await page.goto("/");
    // The catalog search box (home.tsx:987 aria-label).
    const search = page.getByLabel("البحث في المنتجات");
    await expect(search).toBeVisible({ timeout: 15_000 });
    await search.fill("نتفليكس");
    await search.press("Enter");

    // The committed search mirrors into the URL (replaceState — no
    // navigation happens; this is the observable commit and the old
    // swallow-on-timeout hid exactly this).
    await expect(page).toHaveURL(/search=/, { timeout: 10_000 });

    // The matching card renders inside the catalog grid (scoped to main
    // so footer/chrome links cannot satisfy the assertion).
    const card = page.locator("main a[href^='/product/']").filter({ hasText: matches[0].name });
    await expect(card.first()).toBeVisible({ timeout: 15_000 });
    // …and the no-results empty state is NOT shown.
    await expect(page.getByText("لا توجد منتجات تطابق بحثك")).toHaveCount(0);
  });

  test("a garbage Arabic query renders the friendly empty state, not an error page", async ({
    page,
    request,
  }) => {
    // Ground truth: the garbage query genuinely matches nothing (if the
    // catalog ever gains a product matching it, fail HERE with a clear
    // message instead of a confusing DOM assertion).
    const api = await request.get(
      `/api/products?search=${encodeURIComponent("هذا-استعلام-لا-نتائج-له-مطلقا")}`,
    );
    expect(api.status()).toBe(200);
    expect(await api.json()).toEqual([]);

    await page.goto("/");
    const search = page.getByLabel("البحث في المنتجات");
    await expect(search).toBeVisible({ timeout: 15_000 });
    await search.fill("هذا-استعلام-لا-نتائج-له-مطلقا");
    await search.press("Enter");

    // The search committed (URL mirror)…
    await expect(page).toHaveURL(/search=/, { timeout: 10_000 });
    // …the shell stays Arabic (no 5xx / crash page)…
    await expect(page.locator("html[dir='rtl']")).toBeVisible();
    // …the ACTUAL filtered-empty state renders (home.tsx «تطابق بحثك»
    // branch — heading + hint, not merely a truthy body)…
    await expect(page.getByText("لا توجد منتجات تطابق بحثك")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText("جرّب تغيير الفلتر أو كلمة البحث")).toBeVisible();
    // …and no product cards remain in the catalog grid.
    await expect(page.locator("main a[href^='/product/']")).toHaveCount(0);
  });
});
