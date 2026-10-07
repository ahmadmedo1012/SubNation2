/**
 * MobileNav bottom-clearance contract (B6-P1-7).
 *
 * The fixed bottom nav's height used to be reserved TWICE on authed
 * mobile pages: `main.mobile-nav-safe-pad` (72px + inset) AND
 * `Footer.mb-[calc(60px+env)]` — ~132px of dead space, or a covered
 * footer legal row when the margin collapsed through #root (min-height
 * only). Three different constants (60 / 60 / 72) hardcoded the same
 * physical nav in three files.
 *
 * The unified contract (one source, one reservation):
 *   • MOBILE_NAV_HEIGHT (MobileNav.tsx) — the nav's own grid height.
 *   • `--mobile-nav-h` (index.css) — the CSS mirror, consumed by
 *     `mobile-nav-safe-pad` (main's content clearance = nav + ONE 12px
 *     breathing unit) and `mobile-nav-footer-pad` (footer clearance =
 *     exactly nav height, as PADDING so it can never collapse).
 *
 * These tests pin: the exported constant, the CSS mirror equality
 * (drift guard), the main wrapper's class wiring, and the footer's
 * single non-collapsing reservation.
 */

import { act, render, screen, waitFor } from "@testing-library/react";
import { Router } from "wouter";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MOBILE_NAV_HEIGHT, MobileNav } from "@/components/layout/MobileNav";
import { Footer } from "@/components/layout/Footer";

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ token: authState.token }),
}));
const authState = vi.hoisted(() => ({ token: "test-token" as string | null }));

// R120-B1 (A1-F8/A3-F5): MobileNav subscribes to the cart state context
// for the السلة tab's live badge — mocked at the module boundary like
// the auth mock above (the real provider is a main.tsx concern).
const cartState = vi.hoisted(() => ({ itemCount: 0 }));
vi.mock("@/lib/cart", () => ({
  useCartState: () => ({ items: [], itemCount: cartState.itemCount, totalLYD: 0, isLoaded: true }),
}));

// Vitest's jsdom environment doesn't expose import.meta.url with a
// file: scheme — resolve from the runner cwd (always the frontend/
// package dir, both for `npx vitest run` and `pnpm --filter … test:run`).
const cssText = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
const appText = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
// R120-B7: the guest product-page buy bar is asserted read-only (the
// App.tsx pattern above) — its pin must ride the shared above-nav
// clearance now that the guest nav renders on /product/*.
const productText = readFileSync(resolve(process.cwd(), "src/pages/product.tsx"), "utf8");

describe("MobileNav — single-source clearance constant (B6-P1-7)", () => {
  it("exports the nav height and the CSS variable mirrors it (drift guard)", () => {
    expect(MOBILE_NAV_HEIGHT).toBe(60);
    const match = cssText.match(/--mobile-nav-h:\s*(\d+)px/);
    expect(match).not.toBeNull();
    expect(Number(match?.[1])).toBe(MOBILE_NAV_HEIGHT);
  });

  it("the nav itself renders its grid at MOBILE_NAV_HEIGHT", () => {
    render(
      <Router>
        <MobileNav />
      </Router>,
    );
    const nav = screen.getByRole("navigation");
    const grid = nav.querySelector("div.grid");
    expect(grid).toBeInstanceOf(HTMLElement);
    expect((grid as HTMLElement).style.height).toBe(`${MOBILE_NAV_HEIGHT}px`);
  });

  it("mobile-nav-safe-pad reserves nav height + ONE breathing unit from the variable", () => {
    const rule = cssText.match(/\.mobile-nav-safe-pad\s*\{[^}]*\}/)?.[0] ?? "";
    expect(rule).toContain("var(--mobile-nav-h)");
    // The 12px (0.75rem) breathing unit is the ONLY extra dead space.
    expect(rule).toContain("0.75rem");
    expect(rule).toContain("env(safe-area-inset-bottom)");
  });

  it("mobile-nav-footer-pad reserves exactly the nav height as padding (cannot collapse)", () => {
    const rule = cssText.match(/\.mobile-nav-footer-pad\s*\{[^}]*\}/)?.[0] ?? "";
    expect(rule).toContain("var(--mobile-nav-h)");
    expect(rule).toContain("env(safe-area-inset-bottom)");
    // padding-bottom only — a margin could collapse through #root and
    // let the fixed nav cover the footer's legal row.
    expect(rule).toContain("padding-bottom");
    expect(rule).not.toContain("margin");
  });

  it("the App main wrapper applies mobile-nav-safe-pad (content clearance)", () => {
    // App.tsx is owned by another agent (C5) — asserted read-only so the
    // clearance wiring can't silently regress.
    expect(appText).toContain("mobile-nav-safe-pad");
  });

  it("the authed footer reserves clearance via the shared class, not a second hardcoded margin", () => {
    render(
      <Router>
        <Footer />
      </Router>,
    );
    const footer = document.querySelector("footer");
    expect(footer).toBeInstanceOf(HTMLElement);
    const cls = (footer as HTMLElement).className;
    expect(cls).toContain("mobile-nav-footer-pad");
    // The old double reservation: a hardcoded 60px margin bottom.
    expect(cls).not.toContain("mb-[calc(60px");
  });

  // R120-B1 (A3-F1): guests get the MobileNav too — their footer needs
  // the SAME single reservation (main's mobile-nav-safe-pad in App.tsx
  // is still auth-gated, so the footer pad is the guest clearance).
  it("the GUEST footer also reserves the nav clearance (guest MobileNav)", () => {
    authState.token = null;
    try {
      render(
        <Router>
          <Footer />
        </Router>,
      );
      const footer = document.querySelector("footer");
      expect(footer).toBeInstanceOf(HTMLElement);
      expect((footer as HTMLElement).className).toContain("mobile-nav-footer-pad");
    } finally {
      authState.token = "test-token";
    }
  });
});

// R120-B7 (reviewer finding): the guest MobileNav renders on /product/*
// — the buy-bar geometry is reconciled by pinning the guest sticky bar
// ABOVE the nav with the shared clearance utility, and the guest
// clearance contract extends to product pages (footer pad + page-root
// pad both reserve the nav there now).
describe("MobileNav — guest product-page reconciliation (R120-B7)", () => {
  afterEach(() => {
    window.history.pushState({}, "", "/");
    authState.token = "test-token";
  });

  it("the GUEST footer reserves the nav clearance ON product pages (no route exception)", () => {
    authState.token = null;
    window.history.pushState({}, "", "/product/netflix-1m");
    render(
      <Router>
        <Footer />
      </Router>,
    );
    const footer = document.querySelector("footer");
    expect(footer).toBeInstanceOf(HTMLElement);
    expect((footer as HTMLElement).className).toContain("mobile-nav-footer-pad");
  });

  it("the guest sticky buy bar pins above the nav via the shared utility (read-only)", () => {
    // product.tsx guest branch: sticky + mobile-sticky-above-nav (never
    // bottom-0 — that pin would dock under the fixed 60px nav), and the
    // retired mobile-sticky-bottom-safe class is gone from the page.
    expect(productText).toContain('"sticky -mx-4 mobile-sticky-above-nav pb-3"');
    expect(productText).not.toContain("mobile-sticky-bottom-safe");
  });

  it("the guest product page pad reserves the bar AND the nav (main is unpadded for guests)", () => {
    const rule = cssText.match(/\.mobile-product-pad-guest\s*\{[^}]*\}/)?.[0] ?? "";
    // bar (68px) + nav (--mobile-nav-h) + safe-area + breathing unit.
    expect(rule).toContain("68px");
    expect(rule).toContain("var(--mobile-nav-h)");
    expect(rule).toContain("env(safe-area-inset-bottom)");
  });

  it("mobile-sticky-above-nav is defined at the mobile-only breakpoint (the shared pin)", () => {
    const rule = cssText.match(/\.mobile-sticky-above-nav\s*\{[^}]*\}/)?.[0] ?? "";
    expect(rule).toContain("bottom: calc(var(--mobile-nav-h) + env(safe-area-inset-bottom))");
  });
});

describe("MobileNav — 96-F5 (R96 F-4 + P2-3): GPU diet + keyboard hide", () => {
  it("rides a SOLID background — no backdrop-blur on the fixed bar", () => {
    render(
      <Router>
        <MobileNav />
      </Router>,
    );
    const nav = screen.getByRole("navigation");
    // The background layer is the nav's first child (absolute inset-0).
    const bgLayer = nav.firstElementChild as HTMLElement;
    expect(bgLayer.className).toContain("bg-card");
    expect(bgLayer.className).not.toContain("backdrop-blur");
    expect(bgLayer.className).not.toContain("bg-card/92");
  });

  it("carries the no-JS short-viewport fallback class (keyboard/landscape)", () => {
    render(
      <Router>
        <MobileNav />
      </Router>,
    );
    const nav = screen.getByRole("navigation");
    expect(nav.className).toContain("[@media(max-height:480px)]:hidden");
  });

  it("hides while the virtual keyboard is open (visualViewport drop > 120px) and restores on close", () => {
    const listeners: Record<string, (() => void) | undefined> = {};
    const vv = {
      height: 800,
      addEventListener: (type: string, cb: () => void) => {
        listeners[type] = cb;
      },
      removeEventListener: () => {},
    };
    Object.defineProperty(window, "visualViewport", { value: vv, configurable: true });
    try {
      const { unmount } = render(
        <Router>
          <MobileNav />
        </Router>,
      );
      const nav = screen.getByRole("navigation");
      // Exact-token check — "md:hidden" must not count as "hidden".
      expect(nav.classList.contains("hidden")).toBe(false);

      // Keyboard opens: 800 → 460 (drop 340 > 120).
      act(() => {
        vv.height = 460;
        listeners.resize?.();
      });
      expect(nav.classList.contains("hidden")).toBe(true);

      // Keyboard closes: back to the anchored baseline.
      act(() => {
        vv.height = 800;
        listeners.resize?.();
      });
      expect(nav.classList.contains("hidden")).toBe(false);

      unmount();
    } finally {
      delete (window as unknown as Record<string, unknown>).visualViewport;
    }
  });

  it("small sub-120px jitters do NOT hide the nav (no false positives)", () => {
    const listeners: Record<string, (() => void) | undefined> = {};
    const vv = {
      height: 800,
      addEventListener: (type: string, cb: () => void) => {
        listeners[type] = cb;
      },
      removeEventListener: () => {},
    };
    Object.defineProperty(window, "visualViewport", { value: vv, configurable: true });
    try {
      const { unmount } = render(
        <Router>
          <MobileNav />
        </Router>,
      );
      const nav = screen.getByRole("navigation");
      act(() => {
        vv.height = 720; // URL-bar collapse / pinch-zoom wiggle — only 80px
        listeners.resize?.();
      });
      expect(nav.classList.contains("hidden")).toBe(false);
      unmount();
    } finally {
      delete (window as unknown as Record<string, unknown>).visualViewport;
    }
  });

  it("R118-B2 (A2 F-2): a portrait→landscape rotation never latches the nav hidden — the shared hook's orientationchange re-anchor", async () => {
    // The pre-merge inline detector (96-F5 copy) never received R117 F-7:
    // a >120px shrink that is NOT a keyboard (portrait 800 → landscape
    // 620) latched keyboardHidden=true forever — the baseline could only
    // re-anchor on GROWTH past the stale value. MobileNav now consumes
    // the shared useKeyboardVisibility hook, whose orientationchange
    // handler re-anchors after the rotation settles (deferred one rAF).
    const vvListeners: Record<string, (() => void) | undefined> = {};
    const windowListeners: Record<string, Array<() => void>> = {};
    const vv = {
      height: 800,
      addEventListener: (type: string, cb: () => void) => {
        vvListeners[type] = cb;
      },
      removeEventListener: () => {},
    };
    Object.defineProperty(window, "visualViewport", { value: vv, configurable: true });
    const originalAdd = window.addEventListener.bind(window);
    const addSpy = vi.spyOn(window, "addEventListener").mockImplementation(((
      type: string,
      cb: EventListenerOrEventListenerObject,
    ) => {
      (windowListeners[type] ??= []).push(cb as () => void);
      return originalAdd(type, cb);
    }) as typeof window.addEventListener);
    try {
      render(
        <Router>
          <MobileNav />
        </Router>,
      );
      const nav = screen.getByRole("navigation");

      // Rotation begins: the viewport shrinks 800 → 620 (>120px — the
      // resize handler honestly reports "keyboard-like" at first)…
      act(() => {
        vv.height = 620;
        vvListeners.resize?.();
      });
      expect(nav.classList.contains("hidden")).toBe(true);

      // …then the rotation settles: orientationchange fires and the
      // shared hook re-anchors (deferred one rAF → await a frame).
      act(() => {
        for (const cb of windowListeners.orientationchange ?? []) cb();
      });
      await waitFor(() => expect(nav.classList.contains("hidden")).toBe(false));

      // The baseline re-anchored at the LANDSCAPE height: a real keyboard
      // from here (620 → 420, drop 200) still hides the nav — the
      // re-anchor didn't break the detector, it corrected the anchor.
      act(() => {
        vv.height = 420;
        vvListeners.resize?.();
      });
      expect(nav.classList.contains("hidden")).toBe(true);
    } finally {
      addSpy.mockRestore();
      delete (window as unknown as Record<string, unknown>).visualViewport;
    }
  });
});
