import { defineConfig, devices } from "@playwright/test";

/**
 * R123-E2 — the committed guest read-only e2e smoke suite.
 *
 * DESIGN CONTRACT (docs + A2 audit):
 * - Guest journeys ONLY: browsing, search, cart-gate, auth-gates,
 *   SEO shells, API contracts. NO purchases, NO topups, NO logins,
 *   NO OTP requests, NO admin.
 * - Skipped by default: specs call `test.skip(!process.env.E2E_ENABLED)`
 *   so unit CI never needs a running server and no secrets exist.
 * - Base URL: E2E_BASE_URL (default http://localhost:8080 — the local
 *   compose stack). NEVER point at production in CI without operator
 *   review; the cart-gate spec adds a session-scoped cart item (no
 *   money) which is acceptable locally but documented in the spec.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: 2,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:8080",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile-390",
      use: {
        ...devices["Pixel 7"],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
