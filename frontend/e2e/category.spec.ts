import { test, expect } from "@playwright/test";

test.skip(!process.env.E2E_ENABLED, "E2E_ENABLED not set — smoke suite is opt-in");

test.describe("category — browse via a category chip", () => {
  test("chip click lands on /category/:slug and back-nav returns home", async ({ page }) => {
    await page.goto("/");
    const chip = page.locator("a[href^='/category/']").first();
    await expect(chip).toBeVisible({ timeout: 15_000 });
    const href = await chip.getAttribute("href");
    expect(href).toBeTruthy();
    await chip.click();
    await page.waitForURL(/\/category\//);
    // The category grid re-renders (skeleton or cards — not a blank page).
    await expect(page.locator("main")).toBeVisible();
    await page.goBack();
    await expect(page.locator("h1").first()).toBeVisible();
  });
});
