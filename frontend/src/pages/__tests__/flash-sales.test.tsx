/**
 * Countdown honesty tests for the flash-sales page (B4 P1-1).
 *
 * The page used to fabricate `endsAt = now + 6h` on every visit — every
 * user always saw "6:00:00" remaining, a fake-urgency dark pattern that
 * also contradicted the FlashSaleBanner's real timer on the same site.
 * These tests lock in the contract:
 *
 *   1. No active sale on /api/flash-sale ⇒ honest empty state, no
 *      fabricated countdown anywhere.
 *   2. Active sale ⇒ the countdown renders from the REAL `ends_at`.
 *   3. Sale window already closed ⇒ honest "ended" notice, no chips.
 *   4. No active sale ⇒ no interval is ever started.
 *   5. The single page-level interval is cleared on unmount (no leak).
 *
 * Both data hooks (`useListProducts`, `useGetFlashSale`) are mocked at
 * the module boundary — the vitest config's documented pattern for
 * page-level component tests — so no network/react-query engine runs.
 */

import { render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { afterEach, describe, expect, it, vi } from "vitest";
import FlashSalesPage from "@/pages/flash-sales";
import { useGetFlashSale, useListProducts, type Product } from "@workspace/api-client-react";

vi.mock("@workspace/api-client-react", () => ({
  useListProducts: vi.fn(),
  useGetFlashSale: vi.fn(),
}));

type ProductsResult = ReturnType<typeof useListProducts>;
type FlashResult = ReturnType<typeof useGetFlashSale>;

const saleProduct: Product = {
  id: 1,
  name: "Netflix شهر",
  category: "streaming",
  image_url: null,
  slug: "netflix-1m",
  price: 60,
  price_from: false,
  sale_price: 45,
  discount_percent: 25,
  is_active: true,
  is_available: true,
  stock_count: 5,
  order_count: 3,
  variants: [],
};

function mockProducts(over: Partial<ProductsResult>) {
  vi.mocked(useListProducts).mockReturnValue({
    data: [],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    ...over,
  } as unknown as ProductsResult);
}

function mockFlashSale(flash_sale: FlashResult["data"]) {
  vi.mocked(useGetFlashSale).mockReturnValue({
    data: { flash_sale },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  } as unknown as FlashResult);
}

function renderPage() {
  return render(
    <Router>
      <FlashSalesPage />
    </Router>,
  );
}

// Matches a countdown label like "05:59:59" / "59:59" (h:mm:ss or mm:ss).
const COUNTDOWN_RE = /^\d{1,2}:\d{2}(:\d{2})?$/;

describe("FlashSalesPage — countdown driven by the real /api/flash-sale window (B4 P1-1)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("renders the honest empty state (no fabricated countdown) when no sale is active", () => {
    mockProducts({ data: [] });
    mockFlashSale(null);

    renderPage();

    expect(screen.getByText("لا عرض نشط حالياً")).toBeInTheDocument();
    // The old implementation rendered a fake 06:00:00 chip regardless.
    expect(screen.queryByText(COUNTDOWN_RE)).not.toBeInTheDocument();
  });

  it("renders the countdown from the real ends_at when a sale is active", () => {
    vi.useFakeTimers();
    // 6h window minus one second → the shared timer shows 05:59:59.
    const ends_at = new Date(Date.now() + 6 * 60 * 60 * 1000 - 1000).toISOString();
    mockProducts({ data: [saleProduct] });
    mockFlashSale({ id: 9, title: "عرض نهاية الأسبوع", discount_percent: 25, ends_at });

    renderPage();

    expect(screen.getByText("05:59:59")).toBeInTheDocument();
    // The header surfaces the real sale title, not blind urgency copy.
    expect(screen.getByText("عرض نهاية الأسبوع")).toBeInTheDocument();
  });

  it("shows an honest 'ended' notice instead of stale countdown chips when the window closed", () => {
    vi.useFakeTimers();
    const ends_at = new Date(Date.now() - 1000).toISOString();
    mockProducts({ data: [saleProduct] });
    mockFlashSale({ id: 9, title: "عرض منتهي", discount_percent: 25, ends_at });

    renderPage();

    expect(screen.getByText("انتهى هذا العرض")).toBeInTheDocument();
    expect(screen.queryByText(COUNTDOWN_RE)).not.toBeInTheDocument();
  });

  it("starts no countdown timer at all without an active sale (null target ⇒ no interval)", () => {
    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    mockProducts({ data: [saleProduct] });
    mockFlashSale(null);

    renderPage();

    expect(setIntervalSpy).not.toHaveBeenCalled();
  });

  it("clears the single countdown interval on unmount", () => {
    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
    const ends_at = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    mockProducts({ data: [saleProduct] });
    mockFlashSale({ id: 9, title: "عرض", discount_percent: 25, ends_at });

    const { unmount } = renderPage();

    // Exactly ONE page-level timer (the previous per-card design leaked N).
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    const intervalId = setIntervalSpy.mock.results[0]!.value;

    unmount();

    expect(clearIntervalSpy).toHaveBeenCalledWith(intervalId);
  });
});
