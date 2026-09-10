/**
 * 96-F5 (R96-M01 P0 + M08 + M20/A6#21 + P2-2a) — Navbar mobile fit.
 *
 * The authed mobile action row needed ≈337–381px (logo 123 + theme 44 +
 * bell 44 + wallet chip ≥60 + cart 44 + gaps) against 288px of usable
 * width at 320px; with html/body { overflow-x: clip } the cart icon —
 * the row's last item — was cut off-screen and MobileNav has no cart
 * tab, so the whole cart funnel was unreachable on small phones for
 * authed users.
 *
 * These tests pin the fix contract:
 *   • wallet chip hidden below sm (class assertion) + capped/truncated
 *     amount for the sm…md band;
 *   • the cart link is ALWAYS rendered (guest + authed);
 *   • the guest row never pays for the bell's lazy fallback;
 *   • cart badge unified with the bell's (9+ / inline-end corner);
 *   • the header grows by the top safe-area inset and is measurable
 *     (data-navbar-header) for the NotificationPanel offset;
 *   • the viewport meta guard keeps interactive-widget=resizes-content
 *     alive against MetaTags' legacy upsert.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Router } from "wouter";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Navbar } from "@/components/layout/Navbar";

// jsdom's CSSOM rejects env() values (they never reach element.style in
// tests), so the safe-area rule is pinned at the source level — the same
// pattern the clearance/design-system suites use for CSS contracts.
const navbarSource = readFileSync(
  resolve(process.cwd(), "src/components/layout/Navbar.tsx"),
  "utf8",
);

const authState = vi.hoisted(() => ({ token: "test-token" as string | null }));
const cartState = vi.hoisted(() => ({ count: 3 }));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ token: authState.token, logout: () => {} }),
}));

vi.mock("@/lib/cart", () => ({
  useCart: () => ({ itemCount: cartState.count }),
}));

vi.mock("@/lib/theme", () => ({
  useTheme: () => ({ theme: "dark", toggleTheme: () => {} }),
}));

vi.mock("@workspace/api-client-react", () => ({
  getGetMeQueryKey: () => ["me"],
  useGetMe: () => ({
    data: { wallet_balance: 145.5, loyalty_points: 10 },
  }),
}));

// The bell is lazy-loaded inside Navbar; its own panel behavior has a
// dedicated file (notification-bell-panel.test.tsx) — here it's a stub
// so the row-width math under test is exactly the DOM Navbar renders.
vi.mock("@/components/layout/NotificationBell", () => ({
  NotificationBell: () => null,
}));

function renderNavbar() {
  return render(
    <Router>
      <Navbar />
    </Router>,
  );
}

beforeEach(() => {
  authState.token = "test-token";
  cartState.count = 3;
});

afterEach(() => {
  document.querySelector('meta[name="viewport"]')?.remove();
});

describe("Navbar — 96-F5 (R96-M01 P0): the 320px row", () => {
  it("authed: the mobile wallet chip wrapper is hidden below sm (class assertion)", () => {
    renderNavbar();
    // Both chips (desktop + mobile) render the same balance text; the
    // mobile one is the one whose wrapper carries the md:hidden token.
    const balances = screen.getAllByText("145.50 د.ل");
    expect(balances.length).toBe(2);
    const mobileWrapper = balances
      .map((el) => el.closest('[class~="md:hidden"]'))
      .find((el): el is HTMLElement => el !== null);
    expect(mobileWrapper).toBeTruthy();
    // hidden below sm, visible in the 640–768px band only.
    expect(mobileWrapper!.className).toContain("hidden");
    expect(mobileWrapper!.className).toContain("sm:block");
    expect(mobileWrapper!.className).toContain("md:hidden");
  });

  it("authed: the chip amount is capped + truncated (long balances can't re-overflow sm…md)", () => {
    renderNavbar();
    const amount = screen
      .getAllByText("145.50 د.ل")
      .map((el) => el.closest('[class~="md:hidden"]'))
      .find((el): el is HTMLElement => el !== null)!
      .querySelector("span.tabular-nums")!;
    expect(amount.className).toContain("max-w-[96px]");
    expect(amount.className).toContain("truncate");
  });

  it("authed: the cart link is always rendered (the P0 — cart reachable at 320px)", () => {
    renderNavbar();
    const cart = screen.getByRole("link", { name: /السلة/ });
    expect(cart).toHaveAttribute("href", "/cart");
  });

  it("guest: the cart link is rendered and NO wallet chip exists", () => {
    authState.token = null;
    renderNavbar();
    const cart = screen.getByRole("link", { name: /السلة/ });
    expect(cart).toHaveAttribute("href", "/cart");
    // Neither the desktop nor the mobile balance chip mounts.
    expect(screen.queryByText("145.50 د.ل")).not.toBeInTheDocument();
  });

  it("guest: the bell (and its lazy skeleton fallback) is not mounted", () => {
    authState.token = null;
    const { container } = renderNavbar();
    // The Suspense fallback (w-8 h-8 skeleton-shimmer) used to consume
    // 32px of the guest row — enough to transiently clip the cart at 320px.
    expect(container.querySelector(".skeleton-shimmer")).toBeNull();
  });

  it("the row gap tightens below sm (gap-2 sm:gap-3)", () => {
    renderNavbar();
    const header = screen.getByRole("banner");
    const row = header.querySelector("div.h-14") as HTMLElement;
    expect(row.className).toContain("gap-2");
    expect(row.className).toContain("sm:gap-3");
  });
});

describe("Navbar — 96-F5 (R96-M20 + A6 #21): badge unification", () => {
  it("cart badge caps at 9+ (same threshold as the bell) on the inline-end corner", () => {
    cartState.count = 12;
    renderNavbar();
    const badge = screen.getByText("9+");
    expect(badge.className).toContain("-left-0.5");
    expect(badge.className).not.toContain("-right-0.5");
  });

  it("cart badge renders the literal count below the threshold", () => {
    cartState.count = 7;
    renderNavbar();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.queryByText("9+")).not.toBeInTheDocument();
  });
});

describe("Navbar — 96-F5 (R96-M08): top safe-area + measurable header", () => {
  it("the header grows by env(safe-area-inset-top) and carries the panel marker", () => {
    renderNavbar();
    const header = screen.getByRole("banner");
    // Measurable marker — the NotificationPanel derives its offset from
    // this element's real bottom edge (see notification-bell-panel.test).
    expect(header.getAttribute("data-navbar-header")).toBe("1");
    // The safe-area rule itself (jsdom's CSSOM drops env() values, so the
    // inline style is asserted at the source level, not on element.style).
    expect(navbarSource).toContain('style={{ paddingTop: "env(safe-area-inset-top)" }}');
  });
});

describe("Navbar — 96-F5 (P2-2a guard): viewport meta self-healing", () => {
  it("re-appends interactive-widget=resizes-content after a legacy upsert strips it", async () => {
    const meta = document.createElement("meta");
    meta.setAttribute("name", "viewport");
    meta.setAttribute("content", "width=device-width, initial-scale=1, viewport-fit=cover");
    document.head.appendChild(meta);

    renderNavbar();
    // Mount-time ensure():
    expect(meta.getAttribute("content")).toContain("interactive-widget=resizes-content");

    // Simulate MetaTags' fixed-string upsert (it rewrites the whole
    // content attribute on every route)…
    meta.setAttribute("content", "width=device-width, initial-scale=1, viewport-fit=cover");
    expect(meta.getAttribute("content")).not.toContain("interactive-widget");

    // …the MutationObserver restores the key on the next microtask.
    await waitFor(() =>
      expect(meta.getAttribute("content")).toContain("interactive-widget=resizes-content"),
    );
  });

  it("does nothing when no viewport meta exists (bare environments)", () => {
    expect(() => renderNavbar()).not.toThrow();
  });
});

describe("Navbar — regression guard: guest menu toggle still works", () => {
  it("guest: the menu button opens the mobile guest menu", () => {
    authState.token = null;
    renderNavbar();
    fireEvent.click(screen.getByRole("button", { name: "القائمة" }));
    expect(screen.getByText("تسجيل الدخول")).toBeInTheDocument();
  });
});
