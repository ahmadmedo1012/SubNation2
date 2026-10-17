import { test, expect } from "@playwright/test";

test.skip(!process.env.E2E_ENABLED, "E2E_ENABLED not set — smoke suite is opt-in");

/**
 * GUEST SAFETY NOTE (the cart-gate precedent, R160): this spec adds ONE
 * session-scoped cart item (a localStorage write, NO money movement) and
 * drains it — add → Navbar badge → /cart row → remove → empty state →
 * undo. Cart state lives in the guest session only (lib/cart.tsx); never
 * checkout, never pay.
 *
 * R160 (R159-AUDIT gap ii): the cart flow's only e2e coverage was the
 * /checkout guest gate — the badge, the row, the remove and the undo
 * toast (sonner, pinned only by the vitest cart-undo-clear suite) were
 * never asserted live. Ground truth first (the search-arabic idiom): the
 * API picks an available product so the add-to-cart click is
 * unconditional — the CTA is gated on is_available (CtaBlock.tsx:189/199).
 */
test.describe("guest cart drain — the session round-trip", () => {
  test("add → badge → /cart row (name + qty) → remove → empty state → «تراجع» restores", async ({
    page,
    request,
  }) => {
    const api = await request.get("/api/products?available_only=true");
    expect(api.status(), "GET /api/products?available_only=true must be 200").toBe(200);
    const products = (await api.json()) as Array<{
      id: number;
      slug: string | null;
      name: string;
    }>;
    expect(products.length, "live catalog must carry a buyable product").toBeGreaterThan(0);
    const target = products[0];

    await page.goto(`/product/${target.slug ?? target.id}`);
    await expect(page.locator("main").getByText(/د\.ل/).first()).toBeVisible({ timeout: 15_000 });

    // The guest add-to-cart CTA: the full button (≥lg) and the sticky-bar
    // icon-button (<lg) share the accessible name (CtaBlock.tsx:196 text /
    // :203 aria-label) — the visible twin is the one this width offers.
    const add = page
      .getByRole("button", { name: "أضف للسلة — سجّل الدخول عند إتمام الطلب" })
      .filter({ visible: true });
    await expect(add).toBeVisible({ timeout: 15_000 });
    await add.click();

    // The Navbar indicator updates: the cart link's accessible name flips
    // from «السلة، فارغة» to the count plural (Navbar.tsx:672-682 —
    // formatCount(1, …) = «1 منتج»; the badge SPAN itself is
    // aria-hidden chrome, Navbar.tsx:711-716).
    // R160 (mobile-390): the same accessible name is carried by BOTH the
    // Navbar link and the mobile bottom-nav's cart link — the add-twin's
    // visible-surface idiom (and .first()) keeps the locator strict-safe
    // at every width.
    const cartLink = page
      .getByRole("link", { name: "السلة، 1 منتج", exact: true })
      .filter({ visible: true })
      .first();
    await expect(cartLink).toBeVisible({ timeout: 10_000 });

    // /cart: the line renders with its name (cart.tsx:388) and quantity
    // (cart.tsx:501-506, the «الكمية N» counter span).
    await page.goto("/cart");
    await expect(page.getByRole("heading", { name: "سلة المشتريات" })).toBeVisible();
    const row = page.locator("main").getByText(target.name).first();
    await expect(row).toBeVisible();
    await expect(page.getByLabel("الكمية 1")).toBeVisible();

    // Remove via the trash button (cart.tsx:529 aria-label). The
    // X-shown-at-qty-1 stepper twin (cart.tsx:492) shares the label — the
    // trash is the row's LAST such button, and both fire the same
    // removeWithUndo anyway.
    const trash = page.getByRole("button", { name: `حذف المنتج ${target.name}` }).last();
    await trash.click();

    // The empty state — exact copy (cart.tsx:231 EmptyHero title «سلتك
    // فارغة»; the :191 header twin «سلتك فارغة حالياً» stays excluded by
    // the exact match).
    await expect(page.locator("main").getByText("سلتك فارغة", { exact: true })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("ابدأ بتصفح الكتالوج وأضف منتجاتك المفضلة للسلة")).toBeVisible();
    // The badge drained too (Navbar.tsx:681 — «فارغة» at count 0). The
    // same twin discipline as the count assertion above.
    await expect(
      page
        .getByRole("link", { name: "السلة، فارغة", exact: true })
        .filter({ visible: true })
        .first(),
    ).toBeVisible();

    // The undo affordance EXISTS post-removal (cart.tsx:102-112: sonner
    // «تمت إزالة المنتج» + action «تراجع» → addItem re-adds, 6s window)
    // — exercise it. exact: the R-140-k Navbar announcer's removal
    // sentence «تمت إزالة المنتج — السلة فارغة» must not satisfy this.
    await expect(page.getByText("تمت إزالة المنتج", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "تراجع" }).click();

    // The line returns with its quantity (cart.tsx:108 addItem({...item})).
    await expect(page.locator("main").getByText(target.name).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByLabel("الكمية 1")).toBeVisible();
    await expect(cartLink).toBeVisible();
  });
});
