/**
 * 94-C3 — FlashSaleBanner regressions (A3 P2-11 / P2-12 + A7 CLS P2).
 *
 * Pins the three behaviors the round-94 fixes added:
 *
 *   1. Height reservation: a cached active sale (localStorage window)
 *      makes the banner hold a 44px slot BEFORE the first poll
 *      resolves, so the lazy-mounted banner can't push the page down
 *      (~0.05 CLS on every page while a sale runs). A definitive
 *      "no sale" response collapses the slot.
 *   2. Timer hard-stop: the 1s countdown clears itself the moment the
 *      sale window closes (flash-sales.tsx parity) — no perpetual
 *      zero-ticking re-renders.
 *   3. Polling stops once the banner is hidden: dismissed/expired is
 *      terminal; no more 60s /api/flash-sale hits forever.
 *   4. The countdown unit labels are ≥10px (was 7px/50% opacity —
 *      unreadable; the units are functional copy).
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FlashSaleBanner } from "@/components/layout/FlashSaleBanner";

const SALE = {
  title: "عرض نهاية الأسبوع",
  discount_percent: 25,
  ends_at: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
};

function jsonResponse(body: unknown) {
  return {
    ok: true,
    json: async () => body,
  } as Response;
}

function renderBanner() {
  return render(
    <Router>
      <FlashSaleBanner />
    </Router>,
  );
}

/** Resolve the in-flight initial load() with fake timers active. */
async function flushInitialLoad() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("FlashSaleBanner — CLS height reservation (A7 P2)", () => {
  it("renders nothing before the first poll when no cached sale exists", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetchMock);
    renderBanner();
    await flushInitialLoad();
    expect(screen.queryByTestId("flash-sale-reserved")).not.toBeInTheDocument();
  });

  it("holds a 44px slot while the first poll is in flight when a cached sale is active", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem("sn_flash_sale_ends", String(Date.now() + 3_600_000));
    const fetchMock = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetchMock);
    renderBanner();
    await flushInitialLoad();

    const slot = screen.getByTestId("flash-sale-reserved");
    expect(slot).toHaveAttribute("aria-hidden", "true");
    expect((slot as HTMLElement).style.minHeight).toBe("44px");
  });

  it("replaces the slot with the real banner once the sale resolves (no height push)", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem("sn_flash_sale_ends", String(Date.now() + 3_600_000));
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ flash_sale: SALE }));
    vi.stubGlobal("fetch", fetchMock);
    renderBanner();
    await flushInitialLoad();

    expect(screen.getByText("عرض نهاية الأسبوع")).toBeInTheDocument();
    expect(screen.queryByTestId("flash-sale-reserved")).not.toBeInTheDocument();
    // The cached window was refreshed for the next cold load.
    expect(window.localStorage.getItem("sn_flash_sale_ends")).not.toBeNull();
  });

  it("collapses the slot and clears the cache on a definitive no-sale response", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem("sn_flash_sale_ends", String(Date.now() + 3_600_000));
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ flash_sale: null }));
    vi.stubGlobal("fetch", fetchMock);
    renderBanner();
    await flushInitialLoad();

    expect(screen.queryByTestId("flash-sale-reserved")).not.toBeInTheDocument();
    expect(window.localStorage.getItem("sn_flash_sale_ends")).toBeNull();
  });

  it("the rendered banner reserves its own min-height (stable across urgent flips)", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ flash_sale: SALE }));
    vi.stubGlobal("fetch", fetchMock);
    renderBanner();
    await flushInitialLoad();

    const banner = screen.getByText("عرض نهاية الأسبوع").closest("div.border-b")!;
    expect(banner.className).toContain("min-h-[44px]");
  });
});

describe("FlashSaleBanner — countdown honesty + timer hard-stop (flash-sales parity)", () => {
  it("renders the countdown units at ≥10px (was 7px)", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ flash_sale: SALE }));
    vi.stubGlobal("fetch", fetchMock);
    renderBanner();
    await flushInitialLoad();

    for (const unit of ["س", "د", "ث"]) {
      const label = screen.getByText(unit, { selector: "span" });
      expect(label.className).toContain("text-[10px]");
      expect(label.className).not.toContain("text-[7px]");
    }
  });

  it("clears every timer when the sale window closes — no zero-ticking loop", async () => {
    vi.useFakeTimers();
    const shortSale = { ...SALE, ends_at: new Date(Date.now() + 1_500).toISOString() };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ flash_sale: shortSale }));
    vi.stubGlobal("fetch", fetchMock);
    renderBanner();
    await flushInitialLoad();
    expect(screen.getByText("عرض نهاية الأسبوع")).toBeInTheDocument();

    // Past the window: banner unmounts…
    await act(async () => {
      vi.advanceTimersByTime(3_000);
    });
    expect(screen.queryByText("عرض نهاية الأسبوع")).not.toBeInTheDocument();
    // …and BOTH the 1s countdown and the 60s poll are gone (the old
    // code kept ticking 0 forever + polling forever).
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops polling /api/flash-sale after dismissal", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ flash_sale: SALE }));
    vi.stubGlobal("fetch", fetchMock);
    renderBanner();
    await flushInitialLoad();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "إغلاق الشريط" }));
    expect(screen.queryByText("عرض نهاية الأسبوع")).not.toBeInTheDocument();
    // The dismissal also drops the cached window so the next load
    // doesn't reserve height for a banner the user killed.
    expect(window.localStorage.getItem("sn_flash_sale_ends")).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(130_000);
    });
    // Initial load only — the 60s poller is dead (was 3 calls).
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps polling while the banner is visible", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ flash_sale: SALE }));
    vi.stubGlobal("fetch", fetchMock);
    renderBanner();
    await flushInitialLoad();

    await act(async () => {
      vi.advanceTimersByTime(125_000);
    });
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
});
