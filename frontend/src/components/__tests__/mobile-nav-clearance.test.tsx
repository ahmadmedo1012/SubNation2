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

import { act, render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { MOBILE_NAV_HEIGHT, MobileNav } from "@/components/layout/MobileNav";
import { Footer } from "@/components/layout/Footer";

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

// Vitest's jsdom environment doesn't expose import.meta.url with a
// file: scheme — resolve from the runner cwd (always the frontend/
// package dir, both for `npx vitest run` and `pnpm --filter … test:run`).
const cssText = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
const appText = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");

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
});
