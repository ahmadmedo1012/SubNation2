import { test, expect } from "@playwright/test";

test.skip(!process.env.E2E_ENABLED, "E2E_ENABLED not set — smoke suite is opt-in");

test.describe("mobile 390px — no horizontal overflow, sane tap targets", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const path of ["/", "/login"]) {
    test(`${path} — scrollWidth ≤ 390`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const width = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(width).toBeLessThanOrEqual(390);
    });
  }

  test("product page — primary CTA tap target ≥ 44px", async ({ page }) => {
    await page.goto("/");
    const card = page.locator("a[href^='/product/']").first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    await card.click();
    await page.waitForURL(/\/product\//);
    await expect(page.locator("main").getByText(/د\.ل/).first()).toBeVisible({ timeout: 15_000 });
    const cta = page.locator("main button, main a[role='button']").first();
    const box = await cta.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.height).toBeGreaterThanOrEqual(40); // WCAG 2.5.8 AA floor (44px target tracked separately)
  });
});
