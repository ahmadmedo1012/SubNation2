/**
 * R126-L5 (A13-F2) — storefront guest drawer dialog contract.
 *
 * The A13 real-browser audit measured the ≤md guest menu drawer as the
 * one mobile surface with NO keyboard exit: two Esc presses left
 * aria-expanded="true" with the body scroll-lock still engaged, focus
 * never moved in, and the panel carried no dialog semantics — only the
 * toggle/X closed it. These tests pin the fix against the REAL Navbar
 * (module-boundary mocks follow navbar-mobile-fit.test.tsx):
 *
 *   • open  → role="dialog" aria-modal="true" + focus moves into the
 *     panel (the admin drawer's exact move-in, R125 A6 B-15);
 *   • Esc   → the drawer unmounts, aria-expanded flips false, and
 *     focus returns to the hamburger toggle (never <body>);
 *   • Tab   → cycles inside the dialog (the trapTabKey half of the
 *     aria-modal promise, WCAG 2.1.2).
 *
 * The body scroll-lock restore (A13 also measured it surviving Esc)
 * rides the same `open` state and is covered by the cleanup contract
 * below — the lock effect's cleanup runs on every close path.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Router } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Navbar } from "@/components/layout/Navbar";

const authState = vi.hoisted(() => ({ token: null as string | null }));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ token: authState.token, logout: () => {} }),
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

// The bell is authed-only and irrelevant to the guest drawer — stubbed
// the same way navbar-mobile-fit.test.tsx stubs it.
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
  authState.token = null;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Navbar guest drawer — dialog semantics, Esc exit, focus contract (R126 A13-F2)", () => {
  it("opening the drawer announces a modal dialog and moves focus into it", async () => {
    renderNavbar();

    const toggle = screen.getByRole("button", { name: "القائمة" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle);

    const drawer = screen.getByRole("dialog", { name: "القائمة" });
    expect(drawer).toHaveAttribute("aria-modal", "true");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAttribute("aria-controls", "guest-menu");

    // Focus moved INTO the dialog (the panel carries tabIndex -1 so
    // programmatic focus is legal but it never joins the tab order).
    await waitFor(() => {
      expect(document.activeElement).toBe(drawer);
    });
  });

  it("Escape closes the drawer, flips aria-expanded false, and returns focus to the toggle", async () => {
    renderNavbar();

    const toggle = screen.getByRole("button", { name: "القائمة" });
    fireEvent.click(toggle);
    const drawer = screen.getByRole("dialog", { name: "القائمة" });
    await waitFor(() => {
      expect(document.activeElement).toBe(drawer);
    });

    // A13 measured TWO Esc presses leaving the drawer open — the
    // window-level handler must close it on the first press.
    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await waitFor(() => {
      expect(document.activeElement).toBe(toggle);
    });
  });

  it("Tab is trapped inside the open dialog (WCAG 2.1.2 — the aria-modal promise)", () => {
    renderNavbar();

    fireEvent.click(screen.getByRole("button", { name: "القائمة" }));
    const drawer = screen.getByRole("dialog", { name: "القائمة" });
    const focusables = Array.from(
      drawer.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    );
    expect(focusables.length).toBeGreaterThan(3);

    // From the panel itself (before any link), Tab lands on the FIRST
    // drawer link — not on the header controls behind the "modal".
    fireEvent.keyDown(window, { key: "Tab" });
    expect(drawer.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(focusables[0]);
  });

  it("the toggle still closes the drawer (click path unchanged) and releases the scroll lock", async () => {
    renderNavbar();

    const toggle = screen.getByRole("button", { name: "القائمة" });
    fireEvent.click(toggle);
    expect(screen.getByRole("dialog", { name: "القائمة" })).toBeDefined();

    // The scroll-lock effect engages while open…
    await waitFor(() => {
      expect(document.body.style.overflow).toBe("hidden");
    });

    // …and the existing toggle behavior (A13: "keep the existing toggle
    // behavior") still closes — the lock restores with it.
    fireEvent.click(toggle);
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => {
      expect(document.body.style.overflow).toBe("");
    });
  });
});
