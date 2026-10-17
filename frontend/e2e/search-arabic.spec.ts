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

/**
 * R132 — plan-level Arabic journeys. These are DELPLOY-RACE-SAFE by
 * construction: the CI run may execute before the Coolify webhook has
 * finished deploying this very commit, so each case takes the API's
 * answer as ground truth and asserts the DOM surfaces EXACTLY that
 * (the R126-L7 honesty pattern). Post-deploy, the API answers gain the
 * new behavior (duration compounds, category branches) and the same
 * parity assertions keep holding — no timing dependence either way.
 */
test.describe("arabic search — plan-level journeys (R132, API-parity)", () => {
  test("«نتفلكس شهر» surfaces what the API says (month-plan first once R132 is live)", async ({
    page,
    request,
  }) => {
    const api = await request.get(`/api/products?search=${encodeURIComponent("نتفلكس شهر")}`);
    expect(api.status()).toBe(200);
    const matches = (await api.json()) as Array<{ name: string; slug: string | null }>;
    // Ground truth: the Netflix brand must match via the alias in BOTH
    // the old and new engine — this is the floor, not the new behavior.
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.some((m) => /netflix/i.test(m.name))).toBe(true);

    await page.goto("/");
    const search = page.getByLabel("البحث في المنتجات");
    await expect(search).toBeVisible({ timeout: 15_000 });
    await search.fill("نتفلكس شهر");
    await search.press("Enter");
    await expect(page).toHaveURL(/search=/, { timeout: 10_000 });

    // DOM parity: the FIRST card is the API's first row (once R132 is
    // deployed that row is a month-plan — the compound tier; before, it
    // is whichever Netflix row the old engine returned — parity holds).
    const card = page.locator("main a[href^='/product/']").filter({ hasText: matches[0].name });
    await expect(card.first()).toBeVisible({ timeout: 15_000 });
  });

  test("«موسيقى» — a category word either matches (post-R132) or renders the friendly empty state (pre-R132)", async ({
    page,
    request,
  }) => {
    const api = await request.get(`/api/products?search=${encodeURIComponent("موسيقى")}`);
    expect(api.status()).toBe(200);
    const matches = (await api.json()) as Array<{ name: string }>;

    await page.goto("/");
    const search = page.getByLabel("البحث في المنتجات");
    await expect(search).toBeVisible({ timeout: 15_000 });
    await search.fill("موسيقى");
    await search.press("Enter");
    await expect(page).toHaveURL(/search=/, { timeout: 10_000 });

    if (matches.length > 0) {
      // Post-R132: the music category branch fired — the DOM must show
      // the API's rows (Spotify under the live catalog).
      const card = page.locator("main a[href^='/product/']").filter({ hasText: matches[0].name });
      await expect(card.first()).toBeVisible({ timeout: 15_000 });
    } else {
      // Pre-R132 engine: the empty state is honest, and the R132
      // zero-result recovery (category escape links) still renders.
      await expect(page.getByText("لا توجد منتجات تطابق بحثك")).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByText("أو تصفّح الأقسام:")).toBeVisible();
    }
  });
});

/**
 * R161-B — live product suggestions (typing-time affordance) + Escape
 * dismissal. DEPLOY-RACE-SAFE by construction (the soldout-pdp
 * honest-skip precedent): the CI run may execute before the R161-B
 * frontend chunk has deployed, so each case takes the suggestions
 * listbox's PRESENCE as the feature-detect — present → the full
 * API-parity assertions (the same /api/products?search=…&fields=list
 * URL the app fetches is the ground truth); absent → a LOUD named
 * skip so the coordinator can re-run post-deploy. NEVER a silent pass.
 */
test.describe("arabic search — live suggestions (R161-B, deploy-race-safe)", () => {
  test("typing «نتفلكس» offers the API's first match — clicking it navigates to the product (search-suggestions-r161b)", async ({
    page,
    request,
  }) => {
    // Ground truth: the exact request the suggestion dropdown fires.
    const api = await request.get(
      `/api/products?search=${encodeURIComponent("نتفلكس")}&fields=list`,
    );
    expect(api.status(), "GET /api/products?search=نتفلكس&fields=list must be 200").toBe(200);
    const matches = (await api.json()) as Array<{
      name: string;
      slug: string | null;
      id: number;
    }>;
    expect(
      matches.length,
      "live catalog must carry a Netflix match for the suggestions contract",
    ).toBeGreaterThan(0);

    await page.goto("/");
    const search = page.getByLabel("البحث في المنتجات");
    await expect(search).toBeVisible({ timeout: 15_000 });
    // Type WITHOUT Enter — suggestions are the typing-time surface
    // (300ms debounce + the list fetch; the typing itself only arms the
    // page's own 320ms URL mirror, which is not this spec's subject).
    await search.fill("نتفلكس");

    // Feature-detect: the suggestions listbox appears once the
    // debounced fetch lands (4s covers debounce + a slow round trip).
    const listbox = page.getByRole("listbox", { name: "منتجات مطابقة" });
    const present = await listbox.waitFor({ state: "visible", timeout: 4_000 }).then(
      () => true,
      () => false,
    );
    if (!present) {
      test.skip(
        true,
        "R161-B suggestions markup not deployed yet (listbox «منتجات مطابقة» absent) — re-run spec search-suggestions-r161b post-deploy",
      );
    }

    // API parity: the FIRST option is the API's first match (name +
    // the row's category/price vocabulary render inside the option).
    const first = listbox.getByRole("option").first();
    await expect(first).toContainText(matches[0].name, { timeout: 5_000 });

    // Clicking it navigates to that product's page.
    await first.click();
    const href = `/product/${matches[0].slug ?? matches[0].id}`;
    await expect(page).toHaveURL(new RegExp(`${href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`), {
      timeout: 15_000,
    });
    await expect(page.getByRole("heading", { level: 1 })).toContainText(matches[0].name, {
      timeout: 15_000,
    });
  });

  test("Escape dismisses the suggestions dropdown without committing (search-escape-r161b)", async ({
    page,
    request,
  }) => {
    // Same ground truth + feature-detect gate as above — an absent
    // listbox is the pre-deploy engine, not a pass.
    const api = await request.get(
      `/api/products?search=${encodeURIComponent("نتفلكس")}&fields=list`,
    );
    expect(api.status()).toBe(200);
    expect(((await api.json()) as unknown[]).length).toBeGreaterThan(0);

    await page.goto("/");
    const search = page.getByLabel("البحث في المنتجات");
    await expect(search).toBeVisible({ timeout: 15_000 });
    await search.fill("نتفلكس");

    const listbox = page.getByRole("listbox", { name: "منتجات مطابقة" });
    const present = await listbox.waitFor({ state: "visible", timeout: 4_000 }).then(
      () => true,
      () => false,
    );
    if (!present) {
      test.skip(
        true,
        "R161-B suggestions markup not deployed yet (listbox «منتجات مطابقة» absent) — re-run spec search-escape-r161b post-deploy",
      );
    }
    await expect(search).toHaveAttribute("aria-expanded", "true");

    // Escape closes the dropdown (audit defect F#2) — the query text
    // stays in the input (the dismissal is preventDefault'ed against
    // Chromium's type=search quick-clear too).
    await search.press("Escape");
    await expect(search).toHaveAttribute("aria-expanded", "false");
    await expect(listbox).toHaveCount(0);
    await expect(search).toHaveValue("نتفلكس");
  });
});
