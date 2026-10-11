/**
 * R132 (L2-F4) — the desktop categories disclosure contract.
 *
 * The desktop nav had NO category entry point (the hero brand chips and
 * the footer were the only paths to /category/* pages; mobile had the
 * guest drawer's shortcuts since R120-B1). The new «الأقسام» disclosure
 * is pinned here against the REAL Navbar (module-boundary mocks follow
 * navbar-guest-drawer-a11y.test.tsx):
 *
 *   • the trigger exposes aria-expanded/aria-haspopup and opens the 7
 *     live category landing links (lib/categories.ts's slugs);
 *   • Esc closes the popover AND returns focus to the trigger (the
 *     non-modal disclosure contract — the drawer's Esc pair, minus the
 *     modal machinery);
 *   • pointer-down outside closes it;
 *   • navigating through a link closes the popover, and reopening at a
 *     category route marks THAT category aria-current="page".
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

vi.mock("@/components/layout/NotificationBell", () => ({
  NotificationBell: () => null,
}));

/** The 7 live category slugs (lib/categories.ts) the panel must carry. */
const EXPECTED = [
  ["بث مباشر", "/category/streaming"],
  ["موسيقى", "/category/music"],
  ["برامج", "/category/software"],
  ["VPN وشبكات", "/category/vpn"],
  ["ذكاء اصطناعي", "/category/ai-tools"],
  ["أدوات SEO", "/category/seo-tools"],
  ["تعليم", "/category/education"],
] as const;

function renderNavbar() {
  return render(
    <Router>
      <Navbar />
    </Router>,
  );
}

beforeEach(() => {
  authState.token = null;
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Navbar desktop categories disclosure (R132 L2-F4)", () => {
  it("opens from an aria-expanded trigger and lists the 7 live category landing pages", async () => {
    renderNavbar();

    const trigger = screen.getByRole("button", { name: /الأقسام/ });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveAttribute("aria-haspopup", "true");

    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    for (const [label, href] of EXPECTED) {
      const link = screen.getByRole("link", { name: new RegExp(label) });
      expect(link).toHaveAttribute("href", href);
    }
  });

  it("Esc closes the popover and returns focus to the trigger (the disclosure contract)", async () => {
    renderNavbar();

    const trigger = screen.getByRole("button", { name: /الأقسام/ });
    fireEvent.click(trigger);
    expect(screen.getByRole("link", { name: /موسيقى/ })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(trigger).toHaveAttribute("aria-expanded", "false");
    });
    expect(screen.queryByRole("link", { name: /موسيقى/ })).not.toBeInTheDocument();
    // focus returned to the trigger — never stranded on <body>
    expect(trigger).toHaveFocus();
  });

  it("a pointer-down outside the disclosure closes it", async () => {
    renderNavbar();

    const trigger = screen.getByRole("button", { name: /الأقسام/ });
    fireEvent.click(trigger);
    expect(screen.getByRole("link", { name: /برامج/ })).toBeInTheDocument();

    fireEvent.pointerDown(document.body);

    await waitFor(() => {
      expect(trigger).toHaveAttribute("aria-expanded", "false");
    });
  });

  it("navigating through a link closes the popover; reopening at the route marks that category current", async () => {
    renderNavbar();

    const trigger = screen.getByRole("button", { name: /الأقسام/ });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("link", { name: /موسيقى/ }));

    // wouter navigated (jsdom history) and the route-change effect
    // closed the popover behind the new page.
    await waitFor(() => {
      expect(window.location.pathname).toBe("/category/music");
    });
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    // Reopen at the category route — the visited category is current.
    fireEvent.click(trigger);
    const musicLink = screen.getByRole("link", { name: /موسيقى/ });
    expect(musicLink).toHaveAttribute("aria-current", "page");
    // …and a sibling is not.
    expect(screen.getByRole("link", { name: /برامج/ })).not.toHaveAttribute("aria-current");
  });
});
