/**
 * F3-07 (R116) — route-change focus management + title announcement.
 *
 * SPA navigations used to leave keyboard/screen-reader focus wherever
 * the activating element was: SR users got no "new page" cue at all
 * (no page-load event, no announcement), and keyboard users restarted
 * their Tab walk deep inside the PREVIOUS route (often the footer).
 * ScrollToTop (App.tsx) now also focuses <main id="main-content"
 * tabIndex={-1}> on every location change — storefront AND admin (the
 * admin Switch renders inside the same <main>) — and RouteAnnouncer
 * exposes an sr-only polite live region that reads the new page's
 * document.title (maintained per-route by MetaTags / useSeo).
 *
 * These tests pin:
 *   1. focus lands on #main-content after a navigation (preventScroll,
 *      after the scroll reset),
 *   2. the focus target is programmatic-only (tabIndex -1),
 *   3. the announcer is a sr-only polite region that stays silent on
 *      the initial mount (the browser's own load cue covers it),
 *   4. the announcement tracks the NEW title — including the lazy-route
 *      case where the title lands AFTER the location change,
 *   5. two routes sharing a title still re-announce (live-region wipe),
 *   6. App.tsx keeps the real <main> focusable (source contract on the
 *      id + tabIndex, pwa-offline-shell test pattern).
 */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Link, Router } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { RouteAnnouncer, ScrollToTop } from "@/App";

/** Mirrors the real DOM contract AppRoutes renders (F3-07). */
function Harness() {
  return (
    <Router>
      <ScrollToTop />
      <RouteAnnouncer />
      <nav>
        <Link href="/wallet">محفظة</Link>
        <Link href="/orders">الطلبات</Link>
      </nav>
      {/* The real element in App.tsx: id + tabIndex={-1}. */}
      <main id="main-content" tabIndex={-1}>
        المحتوى الرئيسي
      </main>
    </Router>
  );
}

beforeEach(() => {
  window.history.pushState({}, "", "/");
  // jsdom's window.scrollTo is a not-implemented no-op — silence it.
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.title = "";
});

describe("ScrollToTop — focus on navigate (F3-07)", () => {
  it("moves focus to #main-content after a route change", () => {
    render(<Harness />);
    // Focus starts on body (or the link) — NOT on the main content.
    expect(document.getElementById("main-content")).not.toHaveFocus();

    fireEvent.click(screen.getByRole("link", { name: "محفظة" }));

    // The new page's content container is now the cursor position.
    expect(document.getElementById("main-content")).toHaveFocus();
  });

  it("the focus target is programmatic-only (tabIndex -1, not tabbable)", () => {
    render(<Harness />);
    const main = document.getElementById("main-content");
    expect(main).not.toBeNull();
    expect(main!.tabIndex).toBe(-1);
  });

  it("re-focuses on every subsequent navigation (admin-style hops included)", () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole("link", { name: "محفظة" }));
    expect(document.getElementById("main-content")).toHaveFocus();

    // Focus something else (simulating an in-page interaction)…
    screen.getByRole("link", { name: "الطلبات" }).focus();
    expect(document.getElementById("main-content")).not.toHaveFocus();

    // …navigate again — focus returns to the content container.
    fireEvent.click(screen.getByRole("link", { name: "الطلبات" }));
    expect(document.getElementById("main-content")).toHaveFocus();
  });
});

describe("RouteAnnouncer — sr-only title announcement (F3-07)", () => {
  it("renders a polite, sr-only live region", () => {
    render(<Harness />);
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region.className).toContain("sr-only");
  });

  it("stays silent on the initial mount (the browser's load cue covers it)", () => {
    document.title = "الصفحة الأولى";
    render(<Harness />);
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("announces the new page's title after a navigation", async () => {
    vi.useFakeTimers();
    document.title = "الصفحة الأولى";
    render(<Harness />);

    fireEvent.click(screen.getByRole("link", { name: "محفظة" }));
    // Simulate the destination route flushing its MetaTags title AFTER
    // the location change (the lazy-chunk swap-in case).
    document.title = "SubNation — المحفظة";

    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    expect(screen.getByRole("status")).toHaveTextContent("SubNation — المحفظة");
    vi.useRealTimers();
  });

  it("re-announces when the title lands LATE (lazy route chunk)", async () => {
    vi.useFakeTimers();
    document.title = "الصفحة الأولى";
    render(<Harness />);

    fireEvent.click(screen.getByRole("link", { name: "محفظة" }));
    // 200 ms pass — the chunk is still loading, title unchanged.
    // R117 (F-5): the delayed read must stay SILENT on the stale
    // previous-page title (the old behavior announced it, then the
    // observer announced the real one — a stale+fresh double
    // utterance). Only titles that differ from the pre-navigation one
    // are ever announced.
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByRole("status")).toHaveTextContent("");

    // …then the route mounts and writes its title — the <title>
    // observer must pick it up (MutationObserver path).
    document.title = "SubNation — المحفظة";
    await act(async () => {
      // MutationObserver callbacks fire as a microtask — a timer tick
      // flushes them under fake timers.
      await Promise.resolve();
      vi.advanceTimersByTime(1);
    });

    expect(screen.getByRole("status")).toHaveTextContent("SubNation — المحفظة");
    vi.useRealTimers();
  });

  it("stays silent when two routes share the same title (R117 F-5)", async () => {
    vi.useFakeTimers();
    document.title = "SubNation";
    render(<Harness />);

    fireEvent.click(screen.getByRole("link", { name: "محفظة" }));
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    // R117 (F-5): a same-title navigation carries no new information —
    // the pre-R117 wipe+re-announce re-read the identical string,
    // which the skip-stale rule now (correctly) filters out.
    expect(screen.getByRole("status")).toHaveTextContent("");

    // A later navigation to a DIFFERENT title still announces.
    fireEvent.click(screen.getByRole("link", { name: "الطلبات" }));
    document.title = "SubNation — الطلبات";
    await act(async () => {
      await Promise.resolve();
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByRole("status")).toHaveTextContent("SubNation — الطلبات");
    vi.useRealTimers();
  });
});

describe("App.tsx main-content source contract (F3-07)", () => {
  const appText = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");

  it("the real <main> carries id=main-content AND tabIndex={-1}", () => {
    // Static contract on the source (pwa-offline-shell test pattern):
    // the focus call in ScrollToTop is a no-op if a refactor drops the
    // id, and a11y focus breaks if the tabIndex goes missing.
    expect(appText).toContain('<main\n        id="main-content"\n        tabIndex={-1}');
  });
});
