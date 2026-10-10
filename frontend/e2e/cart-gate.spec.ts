import { test, expect } from "@playwright/test";

test.skip(!process.env.E2E_ENABLED, "E2E_ENABLED not set — smoke suite is opt-in");

/**
 * GUEST SAFETY NOTE: this spec adds a cart item (a session-scoped cart
 * write, NO money movement) to verify the checkout guest gate. Cart
 * state lives in the guest session only — acceptable on a local stack
 * and on production alike (never checkout, never pay).
 *
 * R128-IMP-4 (B5-1 / A10 §1-7): the buy gate is now ASSERTED, not
 * probed. The old `const canBuy = await buy.isVisible().catch(…); if
 * (canBuy) {…}` silently skipped the whole cart flow whenever the
 * 4-alternative selector regex drifted — the suite stayed green while
 * asserting nothing (the evaporating-assertion class). The PDP must
 * now show EITHER the guest add-to-cart CTA (the accessible name
 * pinned by product-cta-mobile-r126.test.tsx — the full CTA and the
 * compact sticky-bar icon-button share it) OR the explicit sold-out
 * state «نفد المخزون»; anything else fails loudly. Only the POST-CLICK
 * flow stays conditional — a sold-out product legitimately has no
 * cart step.
 */
test.describe("cart + checkout guest gate", () => {
  test("guest cart renders and checkout redirects to /login?redirect=/checkout", async ({
    page,
  }) => {
    await page.goto("/");
    const card = page.locator("a[href^='/product/']").first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    await card.click();
    await page.waitForURL(/\/product\//);
    await expect(page.locator("main").getByText(/د\.ل/).first()).toBeVisible({ timeout: 15_000 });

    // The gate itself (B5-1): buyable CTA or honest sold-out — never
    // neither. The first card on a live catalog can be a sold-out
    // product; it cannot be a page with NO buy gate at all.
    const buy = page
      .getByRole("button", { name: "أضف للسلة — سجّل الدخول عند إتمام الطلب" })
      .first();
    const soldOut = page.getByText("نفد المخزون").first();
    await expect(buy.or(soldOut)).toBeVisible({ timeout: 15_000 });

    // Post-click flow only: a sold-out product has no cart step.
    if (await buy.isVisible()) {
      await buy.click();
      await page.goto("/cart");
      // Cart page renders (items or the friendly empty state — never a crash).
      await expect(page.locator("main")).toBeVisible();
    }

    // The money page never renders unauthenticated.
    await page.goto("/checkout");
    await page.waitForURL(/\/login/, { timeout: 10_000 });
    expect(page.url()).toContain("/login");
  });
});
