import { test, expect } from "@playwright/test";

test.skip(!process.env.E2E_ENABLED, "E2E_ENABLED not set — smoke suite is opt-in");

/**
 * R160 (R159-AUDIT gap iii): sold-out PDP honesty via API ground truth.
 * The API is the truth source (the api-contracts pattern): the list DTO's
 * is_available = deliverable stock > 0 (catalog.service.ts:559), the same
 * predicate the detail DTO rides (catalog.service.ts:285) — so a product
 * the API calls sold-out must render the PDP's «نفد المخزون» state and NO
 * buy promise (the A9-5 ladder: availability outranks auth, CtaBlock.tsx:81
 * — a guest must never see a login CTA promising a purchase the stock
 * denies).
 *
 * If the live catalog carries no sold-out product the spec SKIPS LOUDLY
 * (an honest logged skip, never a silent pass). NOTHING is mutated to
 * fabricate the state — guest-only, read-only.
 */
test.describe("sold-out PDP — honesty via API ground truth", () => {
  test("the API's sold-out product renders «نفد المخزون» + no dead buy CTA", async ({
    page,
    request,
  }) => {
    // Discovery: the DEFAULT list carries sold-out rows too (products.ts:33
    // — available_only is an opt-in filter, not the default).
    const api = await request.get("/api/products");
    expect(api.status(), "GET /api/products must be 200").toBe(200);
    const products = (await api.json()) as Array<{
      id: number;
      slug: string | null;
      is_available: boolean;
    }>;
    const candidate = products.find((p) => p.is_available === false);
    if (!candidate) {
      test.skip(true, "live catalog has no sold-out product — nothing honest to assert here");
    }

    // Ground truth = the DETAIL payload, the exact document the PDP renders
    // from (by-slug; by-id is byte-identical by construction — the one
    // buildProductDetailDto projection serves both, catalog.service.ts:255).
    // The list and detail ride different cache TTLs (30 s vs 60 s), so a
    // just-changed stock can disagree between them — trust the page's own
    // payload.
    const href = candidate!.slug
      ? `/api/products/by-slug/${encodeURIComponent(candidate!.slug)}`
      : `/api/products/${candidate!.id}`;
    const detailRes = await request.get(href);
    const detail =
      detailRes.status() === 200
        ? ((await detailRes.json()) as { id: number; slug: string | null; is_available: boolean })
        : null;
    if (!detail || detail.is_available !== false) {
      test.skip(true, "list/detail cache skew — the page's own payload is not sold-out right now");
    }

    await page.goto(`/product/${detail!.slug ?? detail!.id}`);
    await expect(page.locator("main").getByText(/د\.ل/).first()).toBeVisible({ timeout: 15_000 });

    // The stock verdict chip: role="status" + aria-label «نفد المخزون»
    // (PriceStockPanel.tsx:58, text at :72) — visible at EVERY width.
    await expect(page.getByRole("status", { name: "نفد المخزون", exact: true })).toBeVisible();

    // NO dead buy button — the A9-5 ladder gates every buy/add/login CTA
    // behind is_available (CtaBlock.tsx:189/199/359/369 add-to-cart,
    // :140+ login, :315+ buy), so NONE may exist in the DOM:
    await expect(
      page.getByRole("button", { name: "أضف للسلة — سجّل الدخول عند إتمام الطلب", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "تسجيل الدخول للشراء", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: "سجّل دخولك للشراء", exact: true })).toHaveCount(
      0,
    );

    const width = page.viewportSize()?.width ?? 0;
    if (width >= 1024) {
      // desktop-chromium: the panel CTA is the DISABLED «نفد المخزون» button
      // — honest aria-label (CtaBlock.tsx:118) + the «تصفّح بدائل في نفس
      // الفئة» recovery (CtaBlock.tsx:133) + the «تحقّق لاحقاً» line (:135).
      const dead = page.getByRole("button", { name: "نفد المخزون — غير متاح للشراء حالياً" });
      await expect(dead).toBeVisible();
      await expect(dead).toBeDisabled();
      await expect(page.getByRole("button", { name: "تصفّح بدائل في نفس الفئة" })).toBeVisible();
    } else {
      // tablet-768 + mobile-390: the sticky bar's compact sold-out state —
      // strike price + «نفد المخزون» + the «بدائل» recovery link-button
      // (CtaBlock.tsx:100/108).
      await expect(page.getByRole("button", { name: "بدائل", exact: true })).toBeVisible();
    }
  });
});
