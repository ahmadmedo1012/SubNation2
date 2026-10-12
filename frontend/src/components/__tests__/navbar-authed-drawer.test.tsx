/**
 * R135 (FE-1) — the authed drawer variant (R124-A4 #5's fix).
 *
 * An authed phone rotated to landscape (<480px height) lost the bottom
 * nav to MobileNav's max-height hide while the Navbar hamburger was
 * guest-only — «المحفظة/طلباتي/حسابي» were unreachable until rotation.
 * The fix, pinned here against the REAL Navbar (module-boundary mocks
 * follow navbar-guest-drawer-a11y.test.tsx):
 *
 *   • the hamburger renders for authed users with the row-fit visibility
 *     contract (mobile-only + the short-viewport variant; below-sm
 *     portrait stays toggle-less — R96-M01's 320px row has no 48px to
 *     spare and MobileNav + /profile cover every destination there);
 *   • it opens an authed dialog (role/aria-modal/aria-controls) carrying
 *     the 8 account rows + the guest drawer's category section verbatim;
 *   • the SAME R126 machinery serves it — Esc closes + focus returns to
 *     the toggle, Tab stays trapped, the body scroll-lock engages, and a
 *     route change closes it;
 *   • the panel scrolls internally (DRAWER_SCROLL_CAP) — the authed
 *     drawer outgrows a landscape viewport while body-scroll-locked;
 *   • تسجيل الخروج closes the drawer BEFORE logout so the guest drawer
 *     can never flash open mid-teardown.
 */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Router } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Navbar } from "@/components/layout/Navbar";

const authState = vi.hoisted(() => ({ token: "test-token" as string | null }));
// The logout mock ALSO tears the token down — the mid-logout test needs
// the real ordering (setOpen(false) before the token flip), not a no-op.
const logoutSpy = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    token: authState.token,
    logout: () => {
      logoutSpy();
      authState.token = null;
    },
  }),
}));

vi.mock("@/lib/cart", () => ({
  useCart: () => ({ itemCount: 0 }),
}));

vi.mock("@/lib/theme", () => ({
  useTheme: () => ({ theme: "dark", toggleTheme: () => {} }),
}));

vi.mock("@workspace/api-client-react", () => ({
  getGetMeQueryKey: () => ["me"],
  useGetMe: () => ({ data: undefined }),
}));

// Stubbed the same way navbar-guest-drawer-a11y.test.tsx stubs it — the
// bell's own panel behavior has its dedicated suite.
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

/** The 8 authed account rows, money-first (AUTHED_DRAWER_LINKS' order). */
const EXPECTED_ROWS = [
  ["المحفظة", "/wallet"],
  ["طلباتي", "/orders"],
  ["السلة", "/cart"],
  ["حسابي", "/profile"],
  ["الولاء", "/loyalty"],
  ["الإحالات", "/referrals"],
  ["الإشعارات", "/notifications"],
  ["الدعم الفني", "/support"],
] as const;

function openAuthedDrawer() {
  const toggle = screen.getByRole("button", { name: "القائمة" });
  fireEvent.click(toggle);
  const drawer = screen.getByRole("dialog", { name: "القائمة" });
  return { toggle, drawer };
}

beforeEach(() => {
  authState.token = "test-token";
  logoutSpy.mockClear();
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Navbar authed drawer — R135 (FE-1 / R124-A4 #5)", () => {
  it("the authed hamburger renders with the mobile-only + row-fit visibility contract", () => {
    renderNavbar();
    const toggle = screen.getByRole("button", { name: "القائمة" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    // Distinct disclosure target — the guest twin keeps "guest-menu".
    expect(toggle).toHaveAttribute("aria-controls", "authed-menu");
    // Mobile-only surface…
    expect(toggle.className).toContain("md:hidden");
    // …hidden in below-sm PORTRAIT (R96-M01's 320px row math has no 48px
    // to spare — MobileNav + /profile cover the destinations there)…
    expect(toggle.className).toContain("hidden");
    expect(toggle.className).toContain("sm:flex");
    // …but present in the short-viewport band where the bottom nav hides
    // (the stranding condition; 767.98px guards the 768px boundary tie).
    expect(toggle.className).toContain("[@media(max-height:480px)_and_(max-width:767.98px)]:flex");
  });

  it("opens the authed dialog with the 8 account rows + the guest category section verbatim", () => {
    renderNavbar();
    const { toggle, drawer } = openAuthedDrawer();

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(drawer).toHaveAttribute("aria-modal", "true");
    expect(drawer).toHaveAttribute("id", "authed-menu");

    // Scoped to the drawer — the header renders its own المحفظة/حسابي/
    // السلة-labeled controls (desktop chip, profile icon, cart link).
    for (const [label, href] of EXPECTED_ROWS) {
      expect(within(drawer).getByRole("link", { name: label })).toHaveAttribute("href", href);
    }
    // The category shortcuts + العروض ride the SAME source the guest
    // drawer renders (DrawerCategoriesSection — one table, zero drift).
    expect(within(drawer).getByRole("link", { name: "بث مباشر" })).toHaveAttribute(
      "href",
      "/category/streaming",
    );
    expect(within(drawer).getByRole("link", { name: "أدوات SEO" })).toHaveAttribute(
      "href",
      "/category/seo-tools",
    );
    expect(within(drawer).getByRole("link", { name: "العروض" })).toHaveAttribute(
      "href",
      "/flash-sales",
    );
    // The guest-only funnel rows never leak into the authed variant…
    expect(within(drawer).queryByRole("link", { name: "تسجيل الدخول" })).toBeNull();
    expect(within(drawer).queryByRole("link", { name: /إنشاء حساب/ })).toBeNull();
    // …and تسجيل الخروج is a BUTTON row (an action, not a navigation).
    expect(within(drawer).getByRole("button", { name: "تسجيل الخروج" })).toBeDefined();
  });

  it("the panel scrolls internally — BOTH drawer variants share the cap (R124-A4 #5's landscape math)", () => {
    // The class tokens are pinned (jsdom's CSSOM can't compute calc/env,
    // the same reason navbar-mobile-fit pins safe-area rules at source).
    const CAP_TOKENS = [
      "max-h-[calc(",
      // portrait reserves the bottom-nav clearance (mobile-sticky-above-nav idiom)
      "var(--mobile-nav-h)",
      "overflow-y-auto",
      "overscroll-contain",
      // ≤480px viewports drop that reservation — the nav itself hides
      // there (the keyboard fallback pinned by mobile-nav-clearance).
      "[@media(max-height:480px)]:max-h-[calc(",
    ];

    const { unmount } = renderNavbar();
    const { drawer } = openAuthedDrawer();
    for (const cls of CAP_TOKENS) expect(drawer.className).toContain(cls);
    unmount();

    // The guest drawer rides the same body scroll-lock — the cap is
    // shared, so pin it on the twin too.
    authState.token = null;
    renderNavbar();
    fireEvent.click(screen.getByRole("button", { name: "القائمة" }));
    const guestDrawer = screen.getByRole("dialog", { name: "القائمة" });
    for (const cls of CAP_TOKENS) expect(guestDrawer.className).toContain(cls);
  });

  it("Esc closes the authed drawer and returns focus to the toggle (shared R126 machinery)", async () => {
    renderNavbar();
    const { toggle, drawer } = openAuthedDrawer();
    await waitFor(() => {
      expect(document.activeElement).toBe(drawer);
    });

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await waitFor(() => {
      expect(document.activeElement).toBe(toggle);
    });
  });

  it("Tab is trapped inside the open dialog and the body scroll-lock engages", async () => {
    renderNavbar();
    const { drawer } = openAuthedDrawer();

    await waitFor(() => {
      expect(document.body.style.overflow).toBe("hidden");
    });

    // From the panel itself (before any row), Tab lands inside the
    // dialog — never on the header controls behind the "modal".
    fireEvent.keyDown(window, { key: "Tab" });
    expect(drawer.contains(document.activeElement)).toBe(true);
  });

  it("navigating through a row closes the drawer and releases the scroll lock", async () => {
    renderNavbar();
    const { drawer } = openAuthedDrawer();
    fireEvent.click(within(drawer).getByRole("link", { name: "المحفظة" }));

    // wouter navigated (jsdom history) and the route-change effect closed
    // the drawer behind the new page — the shared close path.
    await waitFor(() => {
      expect(window.location.pathname).toBe("/wallet");
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => {
      expect(document.body.style.overflow).toBe("");
    });
  });

  it("تسجيل الخروج closes the drawer BEFORE logout — no guest-drawer flash mid-teardown", async () => {
    renderNavbar();
    const { toggle, drawer } = openAuthedDrawer();

    fireEvent.click(within(drawer).getByRole("button", { name: "تسجيل الخروج" }));

    expect(logoutSpy).toHaveBeenCalledTimes(1);
    // The drawer is gone…
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    // …and the mock teardown (token → null) did NOT flash the GUEST drawer
    // open — `!token && open` never held with open=true (setOpen landed in
    // the same commit).
    expect(screen.queryByRole("link", { name: "تسجيل الدخول" })).toBeNull();
    // The shared close path returns focus to the still-mounted toggle.
    await waitFor(() => {
      expect(document.activeElement).toBe(toggle);
    });
  });
});
