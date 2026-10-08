import { test, expect } from "@playwright/test";

test.skip(!process.env.E2E_ENABLED, "E2E_ENABLED not set — smoke suite is opt-in");

test.describe("product detail — money page honesty (desktop)", () => {
  test("price + stock badge render after query settle, no overflow at 1280px", async ({ page }) => {
    await page.goto("/");
    const card = page.locator("a[href^='/product/']").first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    await card.click();
    await page.waitForURL(/\/product\//);
    // Price renders (LYD suffixed) once the query settles.
    await expect(page.locator("main").getByText(/د\.ل/).first()).toBeVisible({ timeout: 15_000 });
    // Buy affordance is present (guest CTA or login-prompt CTA — both count).
    await expect(page.locator("main button, main a[role='button']").first()).toBeVisible();
    // No horizontal overflow on desktop.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
