import { test, expect } from "@playwright/test";

test.skip(!process.env.E2E_ENABLED, "E2E_ENABLED not set — smoke suite is opt-in");

test.describe("auth gates — money pages never render unauthenticated, never 5xx", () => {
  for (const path of ["/wallet", "/orders", "/loyalty"]) {
    test(`${path} redirects to login (HTTP-level: no 5xx)`, async ({ page }) => {
      const response = await page.goto(path);
      // The shell always answers 200 (SPA); deep verification is the
      // client redirect below. Guard the negative: no 5xx at the HTTP layer.
      expect(response?.status()).toBeLessThan(500);
      await page.waitForURL(/\/login/, { timeout: 10_000 });
      expect(page.url()).toContain("/login");
    });
  }
});
