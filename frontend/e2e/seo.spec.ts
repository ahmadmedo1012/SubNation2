import { test, expect } from "@playwright/test";

test.skip(!process.env.E2E_ENABLED, "E2E_ENABLED not set — smoke suite is opt-in");

test.describe("SEO shells — robots, sitemap, 404 shape", () => {
  test("robots.txt advertises the sitemap", async ({ request }) => {
    const res = await request.get("/robots.txt");
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain("Sitemap:");
    expect(body).toContain("/sitemap.xml");
  });

  test("sitemap.xml lists product URLs", async ({ request }) => {
    const res = await request.get("/sitemap.xml");
    expect(res.status()).toBe(200);
    const xml = await res.text();
    expect(xml).toContain("<loc>");
    expect(xml).toContain("/product/");
  });

  test("an unknown path serves the noindex shell + client 404 UI", async ({ page }) => {
    const response = await page.goto("/xyz-r123-e2e-unknown");
    expect(response?.status()).toBe(200); // SPA shell
    const robots = await page.locator('meta[name="robots"], meta[name="ROBOTS"]').first();
    await expect(robots).toHaveAttribute("content", /noindex/i, { timeout: 15_000 });
    await expect(page.getByText(/غير موجودة|404/).first()).toBeVisible({ timeout: 15_000 });
  });
});
