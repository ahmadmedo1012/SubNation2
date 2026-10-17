import { test, expect } from "@playwright/test";

test.skip(!process.env.E2E_ENABLED, "E2E_ENABLED not set — smoke suite is opt-in");

/**
 * R160 (R159-AUDIT gap i): the 640–1024 viewport band had NO e2e project —
 * the suite ran only 1280 (desktop-chromium) and 390 (mobile-390), so the
 * R157 fix (that band had NEITHER buy affordance; now the sticky bar owns
 * <lg and the buy panel ≥lg — BuyPanelColumn.tsx:144-149) was never
 * exercised at its own width. The tablet-768 project (playwright.config.ts)
 * closes the band; this spec runs under EVERY project and branches on the
 * live viewport, so the desktop inverse is pinned in the same run.
 *
 * Ground truth first (the search-arabic idiom): the first home card can
 * be a sold-out product, and the sticky bar's BUY button only exists on
 * buyable ones (CtaBlock.tsx:81 availability branch) — the API picks an
 * available target so every assertion below is unconditional (the
 * R128-IMP-4 evaporating-assertion lesson in cart-gate.spec.ts).
 *
 * Deliberately minimal (the audit's scope): visibility + keyboard
 * operability + the desktop inverse. The guest bar's footer-overlap
 * geometry (product.tsx:745-760, the R120-B7 sticky-not-fixed landing)
 * stays to the unit/VLM lanes.
 */
test.describe("PDP buy affordance — exactly one sticky surface per width (R157 band)", () => {
  test("sticky bar <lg / buy panel ≥lg; the bar's guest CTA is keyboard-operable", async ({
    page,
    request,
  }) => {
    const api = await request.get("/api/products?available_only=true");
    expect(api.status(), "GET /api/products?available_only=true must be 200").toBe(200);
    const products = (await api.json()) as Array<{ id: number; slug: string | null }>;
    expect(products.length, "live catalog must carry a buyable product").toBeGreaterThan(0);
    const target = products[0];

    await page.goto(`/product/${target.slug ?? target.id}`);
    // The PDP settled (product-detail.spec idiom: a LYD price renders once
    // the by-slug query resolves).
    await expect(page.locator("main").getByText(/د\.ل/).first()).toBeVisible({ timeout: 15_000 });

    // The two guest CTA surfaces are the SAME CtaBlock with different
    // labels (CtaBlock.tsx:175): compact = «سجّل دخولك للشراء» (the
    // sticky-bar twin — product.tsx:730 `lg:hidden` bar), full =
    // «تسجيل الدخول للشراء» (inside BuyPanelColumn.tsx:149 `hidden
    // lg:block` wrapper).
    const barCta = page.getByRole("button", { name: "سجّل دخولك للشراء", exact: true });
    const panelCta = page.getByRole("button", { name: "تسجيل الدخول للشراء", exact: true });

    const width = page.viewportSize()?.width ?? 0;
    if (width < 1024) {
      // tablet-768 + mobile-390: the sticky bar owns the buy affordance…
      await expect(barCta).toBeVisible();
      // …and the in-panel CTA is display:none (BuyPanelColumn.tsx:149).
      await expect(panelCta).toBeHidden();

      // R161-G (pin hardening): visibility proves the bar RENDERS in the
      // band — not that it PINS. R157 widened the bar to lg:hidden but
      // left every clearance rule scoped ≤639.98px, so position:sticky
      // had NO bottom offset across 640-1023 (Lane F measured the bar at
      // y=1281 with scrollY=800 at 768×1024 — no buy affordance mid-PDP).
      // Scroll past the bar's in-flow position and assert the PIN: the
      // CTA box stays fully inside the viewport (390: docked above the
      // MobileNav; 768-1023: at the safe-area floor).
      await page.evaluate(() => window.scrollBy(0, Math.round(window.innerHeight * 1.5)));
      const pinned = await barCta.boundingBox();
      expect(pinned, "the sticky-bar CTA must have a box after scrolling").not.toBeNull();
      const viewportHeight = page.viewportSize()?.height ?? 0;
      expect(pinned!.y).toBeGreaterThanOrEqual(0);
      expect(pinned!.y + pinned!.height).toBeLessThanOrEqual(viewportHeight + 1);

      // Keyboard operability: focus + Enter fires the same onLogin a tap
      // does — the guest lands on /login?intent=buy (product.tsx:640-643),
      // never a purchase (the config's guest-only contract).
      await barCta.focus();
      await page.keyboard.press("Enter");
      await page.waitForURL(/\/login\?intent=buy/, { timeout: 10_000 });
    } else {
      // desktop-chromium (≥lg): the inverse — panel CTA visible, bar hidden.
      await expect(panelCta).toBeVisible();
      await expect(barCta).toBeHidden();
    }
  });
});
