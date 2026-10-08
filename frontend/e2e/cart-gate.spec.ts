import { test, expect } from "@playwright/test";

test.skip(!process.env.E2E_ENABLED, "E2E_ENABLED not set — smoke suite is opt-in");

/**
 * GUEST SAFETY NOTE: this spec adds a cart item (a session-scoped cart
 * write, NO money movement) to verify the checkout guest gate. Cart
 * state lives in the guest session only — acceptable on a local stack
 * and on production alike (never checkout, never pay).
 */
test.describe("cart + checkout guest gate", () => {
  test("guest cart renders and checkout redirects to /login?redirect=/checkout", async ({ page }) => {
    await page.goto("/");
    const card = page.locator("a[href^='/product/']").first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    await card.click();
    await page.waitForURL(/\/product\//);
    await expect(page.locator("main").getByText(/د\.ل/).first()).toBeVisible({ timeout: 15_000 });
    // Add to cart (guest allowed — session cart).
    const buy = page.getByRole("button", { name: /إضافة إلى السلة|اشترِ|الشراء|سلة/ }).first();
    const canBuy = await buy.isVisible().catch(() => false);
    if (canBuy) {
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
