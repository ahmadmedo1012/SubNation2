/**
 * ROUTE_SHAPES mapping regression tests (B4 P1-5 + B6 P2-17a/c).
 *
 * The shape map feeds the Suspense fallback for every lazy route: the
 * skeleton must occupy the same footprint the real page is about to, so
 * the swap-in is a content-fill, not a layout jump. These tests pin the
 * entries that were previously wrong or missing:
 *
 *   - /checkout: was mapped to "form" (a 448px narrow card skeleton)
 *     while the real payment page is a max-w-5xl two-column layout —
 *     a ~576px width jump on the money-critical funnel step.
 *   - /onboarding, /terms: were unmapped → "blank" (empty flash).
 *   - /admin/login: fell through to the "admin" table shell while the
 *     page is a small centered form.
 *
 * Order-sensitivity (specific regexes before general prefixes) is also
 * locked in so the /orders/:code-before-/orders and
 * /admin/login-before-/admin guarantees can't silently regress.
 */

import { describe, expect, it } from "vitest";
import { shapeForRoute } from "@/App";

describe("ROUTE_SHAPES (App.tsx route → skeleton shape map)", () => {
  it("maps /checkout to a wide content shape, not the narrow form skeleton (B4 P1-5)", () => {
    const shape = shapeForRoute("/checkout");
    // "form" = max-w-448px stacked-fields card — the money page is a
    // max-w-5xl grid with a 360px summary aside. Round 92 (C7): a
    // dedicated "checkout" shell (same max-w-5xl + grid geometry) is
    // wired in App.tsx for a zero-jump skeleton→content transition.
    expect(shape).not.toBe("form");
    expect(shape).not.toBe("blank");
    expect(shape).toBe("checkout");
  });

  it("maps /onboarding to a shape instead of the blank flash (B6 P2-17a)", () => {
    expect(shapeForRoute("/onboarding")).toBe("form");
  });

  it("maps /terms to a shape instead of the blank flash (B6 P2-17a)", () => {
    // The terms page root is max-w-2xl — matched exactly by the
    // "order" shell, the closest width/content profile available.
    expect(shapeForRoute("/terms")).not.toBe("blank");
    expect(shapeForRoute("/terms")).toBe("order");
  });

  it("gives /admin/login the form shell, not the admin table shell (B6 P2-17c)", () => {
    expect(shapeForRoute("/admin/login")).toBe("form");
    // …while every other admin route keeps the admin shell.
    expect(shapeForRoute("/admin")).toBe("admin");
    expect(shapeForRoute("/admin/orders")).toBe("admin");
    expect(shapeForRoute("/admin/products/enrichment")).toBe("admin");
  });

  it("keeps the more specific /orders/:code entry ahead of /orders", () => {
    expect(shapeForRoute("/orders/SN-1234")).toBe("order");
    expect(shapeForRoute("/orders")).toBe("list");
  });

  it("maps the R123-E4b width/archetype corrections (wallet / referrals / profile / flash-sales)", () => {
    // Wallet's page root is max-w-5xl (wallet.tsx) — the default list
    // shell at max-w-3xl width-jumped the swap-in.
    expect(shapeForRoute("/wallet")).toBe("list-wide");
    // Referrals + profile roots are max-w-2xl.
    expect(shapeForRoute("/referrals")).toBe("list-narrow");
    expect(shapeForRoute("/profile")).toBe("list-narrow");
    // The flash page has NO filter row — the catalog shell painted a
    // phantom filter bar there.
    expect(shapeForRoute("/flash-sales")).toBe("grid");
  });

  it("leaves chromeless/unknown routes on the blank fallback", () => {
    expect(shapeForRoute("/status")).toBe("blank");
    expect(shapeForRoute("/auth/callback")).toBe("blank");
    expect(shapeForRoute("/definitely-not-a-route")).toBe("blank");
  });
});
