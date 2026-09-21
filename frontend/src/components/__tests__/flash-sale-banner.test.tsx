/**
 * 94-C3 → R104 — FlashSaleBanner regressions.
 *
 * Pins the behaviors the fixes added:
 *
 *   1. Height reservation (94-C3): a cached active sale (localStorage
 *      window) makes the banner hold a 44px slot BEFORE the first fetch
 *      resolves; a definitive "no sale" response collapses the slot.
 *   2. Timer hard-stop (94-C3): the 1s countdown clears itself the
 *      moment the sale window closes — no perpetual zero-ticking.
 *   3. Polling stops once the banner is hidden (94-C3):
 *      dismissed/expired is terminal.
 *   4. The countdown unit labels are ≥10px (was 7px/50%).
 *
 * R104 (free-tier sleep economics — AG2-1, P0): the banner now rides
 * the shared useGetFlashSale query with an ADAPTIVE cadence:
 *   5. active sale → one /api/flash-sale hit per 60 s;
 *   6. no active sale (the common case) → 10-minute cadence, NOT one
 *      per minute — the old raw interval kept the Render free instance
 *      permanently awake from any open tab;
 *   7. the shared query key means the banner consumes the same cache
 *      entry the /flash-sales page uses (no duplicate mount fetch when
 *      fresh).
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FlashSaleBanner } from "@/components/layout/FlashSaleBanner";

const SALE = {
  id: 1,
  title: "عرض نهاية الأسبوع",
  discount_percent: 25,
  ends_at: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
};

/** Full Response-like mock — the banner rides the generated client
 * (customFetch), which reads content-type to pick the parser, so the
 * minimal {ok, json} stub used by the old raw-fetch tests is not
 * enough (shape mirrors lib/__tests__/custom-fetch-network.test.ts). */
function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    url: "",
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function renderBanner() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <Router>
        <FlashSaleBanner />
      </Router>
    </QueryClientProvider>,
  );
}

/** Resolve the in-flight initial query fetch with fake timers active. */
async function flushInitialLoad() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
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

  it("stops ALL /api/flash-sale traffic when the sale window closes — no zero-ticking loop", async () => {
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

    // …and the query is disabled (expired is terminal): no further
    // network hits for a long time (the old code kept polling forever).
    const callsAtExpiry = fetchMock.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700_000);
    });
    expect(fetchMock.mock.calls.length).toBe(callsAtExpiry);
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
      await vi.advanceTimersByTimeAsync(130_000);
    });
    // Initial load only — the poller is dead (was 3 calls).
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("FlashSaleBanner — R104 adaptive cadence (free-tier sleep economics)", () => {
  it("ACTIVE sale → one /api/flash-sale hit per 60 s", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ flash_sale: SALE }));
    vi.stubGlobal("fetch", fetchMock);
    renderBanner();
    await flushInitialLoad();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("NO active sale → 10-minute cadence, not one per minute (the P0 fix)", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ flash_sale: null }));
    vi.stubGlobal("fetch", fetchMock);
    renderBanner();
    await flushInitialLoad();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Five minutes of an open tab: the OLD code would have fired 5
    // requests (60 s interval); the adaptive query must stay quiet.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // …and only refetches at the 10-minute mark.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000 + 5_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("a hidden tab never polls (refetchIntervalInBackground defaults to false)", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ flash_sale: SALE }));
    vi.stubGlobal("fetch", fetchMock);
    renderBanner();
    await flushInitialLoad();

    // Background the tab: the interval must stop firing (React Query
    // only runs refetchInterval while the tab is focused unless
    // refetchIntervalInBackground is true).
    await act(async () => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(180_000);
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "visible",
      });
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
