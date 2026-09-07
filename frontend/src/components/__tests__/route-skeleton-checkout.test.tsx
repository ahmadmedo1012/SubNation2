/**
 * Checkout skeleton shape (B4 P1-5 / B6-P1-5).
 *
 * /checkout is a max-w-5xl two-column page (payment/coupon stack +
 * 360px sticky summary aside — pages/checkout.tsx:272,284). The generic
 * shapes all mismatch it: "form" is a 448px card (~576px width jump on
 * the money-critical funnel step), "detail" is the closest but still a
 * single-column max-w-4xl shell.
 *
 * This test pins the dedicated "checkout" shell's geometry so the
 * App.tsx route-map flip ([/^\/checkout/, "detail"] → "checkout") is a
 * pure ROUTE_SHAPES change with zero new code. NOTE: App.tsx is owned
 * by another agent and deliberately still maps /checkout → "detail"
 * (pinned by pages/__tests__/route-shapes.test.ts); wiring this shape
 * is the documented follow-up.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RouteSkeleton } from "@/components/ui/route-skeleton";

describe("RouteSkeleton — checkout shape (B4 P1-5 / B6-P1-5)", () => {
  it("renders the max-w-5xl two-column grid of the real checkout page", () => {
    render(<RouteSkeleton shape="checkout" />);

    const root = screen.getByRole("status");
    const container = root.querySelector(".max-w-5xl");
    expect(container).toBeInstanceOf(HTMLElement);

    const grid = root.querySelector(".grid");
    expect(grid).toBeInstanceOf(HTMLElement);
    expect((grid as HTMLElement).className).toContain("md:grid-cols-[1fr_360px]");
    expect((grid as HTMLElement).className).toContain("gap-5");
  });

  it("has a two-card main column and a sticky 360px summary aside", () => {
    render(<RouteSkeleton shape="checkout" />);

    // Summary aside: sticky + top offset, like checkout.tsx's <aside>.
    const aside = document.querySelector(".md\\:sticky");
    expect(aside).toBeInstanceOf(HTMLElement);
    expect((aside as HTMLElement).className).toContain("md:top-20");

    // Main column holds the payment-method card + the coupon card.
    const mainColumn = document.querySelector(".max-w-5xl .grid > .space-y-4");
    expect(mainColumn).toBeInstanceOf(HTMLElement);
    const cards = (mainColumn as HTMLElement).querySelectorAll(":scope > .bg-card");
    expect(cards.length).toBe(2);
  });

  it("shimmers and announces loading like every other shell", () => {
    render(<RouteSkeleton shape="checkout" />);

    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveAttribute("aria-label", "جاري تحميل الصفحة");
    expect(status.querySelectorAll(".skeleton-shimmer").length).toBeGreaterThan(0);
  });
});
