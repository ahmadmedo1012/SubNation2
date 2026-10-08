import { test, expect } from "@playwright/test";

test.skip(!process.env.E2E_ENABLED, "E2E_ENABLED not set — smoke suite is opt-in");

test.describe("home — guest storefront shell", () => {
  test("renders the product grid with Arabic headings and no console errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    await page.goto("/");
    await expect(page).toHaveTitle(/SubNation/);
    await expect(page.locator("h1").first()).toBeVisible();
    // The catalog grid settles with at least one product card (skeleton → content).
    const card = page.locator("a[href^='/product/']").first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    expect(errors, `console errors: ${errors.join(" | ")}`).toHaveLength(0);
  });
});
