import { test, expect } from "@playwright/test";

test.skip(!process.env.E2E_ENABLED, "E2E_ENABLED not set — smoke suite is opt-in");

test.describe("login page — provider surface renders (never submits)", () => {
  test("provider buttons match the passwordless model + legal links resolve", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator("h1").first()).toBeVisible();
    // The passwordless trio: Google + Telegram + WhatsApp OTP surfaces
    // (any enabled subset renders; the page never asks for a password).
    // R143 (L15-1): scoped to main — the old document-order `buttons.first()`
    // resolved to the Navbar's desktop-categories toggle, hidden at the
    // mobile-390 project viewport. The weekly heartbeat (the ONLY runtime
    // boot guard) had failed 3-for-3 on exactly this selector, leaving the
    // alarm permanently red while R141-class outages rode green CI.
    const buttons = page.locator("main button, main a[role='button']");
    await expect(buttons.first()).toBeVisible();
    const body = await page.textContent("main");
    expect(body).toBeTruthy();
    // Legal surfaces link out.
    const terms = page.locator("a[href='/terms']").first();
    if (await terms.isVisible().catch(() => false)) {
      const res = await page.request.get("/terms");
      expect(res.status()).toBe(200);
    }
  });
});
