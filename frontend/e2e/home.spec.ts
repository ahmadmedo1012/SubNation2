import { test, expect } from "@playwright/test";

test.skip(!process.env.E2E_ENABLED, "E2E_ENABLED not set — smoke suite is opt-in");

/**
 * Hermetic-stack noise the collector deliberately ignores (R168-e2e).
 * These classes appear ONLY on a local http origin with a GA tag baked
 * and a deliberately-bogus Sentry DSN — the hermetic CI stack — and are
 * inert against the production heartbeat (https + a real DSN):
 *
 *  · GA tag-health pixels: gtag.js pings googletagmanager.com/a?id=… as
 *    IMAGES on INSECURE origins; the CSP img-src ('self' 'data:' — the
 *    R136 SEC F2 posture, kept deliberately tight) blocks them and the
 *    browser logs a CSP violation. On https these diagnostics never
 *    fire as images.
 *  · Sentry 403s: the hermetic build points VITE_SENTRY_DSN at a
 *    valid-shaped but bogus key — ingest answers 403 and the browser
 *    logs the resource failure. A real DSN never 403s.
 *
 * APP-side console errors — the thing this spec actually guards — still
 * fail the test: any message that is not one of these two third-party
 * transport classes is collected exactly as before.
 */
const THIRD_PARTY_TRANSPORT_NOISE = [
  /googletagmanager\.com\/a\?id=/, // GA tag-health image pixel (CSP-blocked, http origins only)
  /ingest\.sentry\.io.*(403|401)/, // hermetic bogus-DSN refusal
  /Failed to load resource.*sentry/i, // the same refusal, the browser's generic spelling
];
const isTransportNoise = (text: string) => THIRD_PARTY_TRANSPORT_NOISE.some((re) => re.test(text));

test.describe("home — guest storefront shell", () => {
  test("renders the product grid with Arabic headings and no console errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error" && !isTransportNoise(msg.text())) errors.push(msg.text());
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
