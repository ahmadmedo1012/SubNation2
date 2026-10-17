/**
 * 98-F7 (R98-04 — A5 §2 + r97 F-16) — home catalog filter tests.
 *
 * The four catalog filters (search/category/sort/availableOnly) were
 * local state only: a refresh, a back-navigation from a product page,
 * or a shared filtered link all landed on a zeroed catalog (the admin
 * surface got ?search= syncing in 94-C2 — the storefront never did).
 *
 * Contract pinned here:
 *
 *   1. Mount WITH query params ⇒ filters applied (chips pressed,
 *      select value, params handed to the products query, search box
 *      pre-filled).
 *   2. Changing a filter ⇒ history.replaceState mirrors it into the
 *      querystring (replaceState — same logical page, invisible to
 *      wouter).
 *   3. Bogus category/sort values in the URL are whitelisted away
 *      (no blank <select>, no phantom chip).
 *
 * The api-client hooks are mocked at the module boundary (flash-sales
 * test pattern); useSeo is stubbed to keep the head out of jsdom.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { keepPreviousData } from "@tanstack/react-query";
import { Router } from "wouter";
import { CartProvider } from "@/lib/cart";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HomePage from "@/pages/home";
import {
  useGetCatalogStats,
  useGetMe,
  useListOrders,
  useListProducts,
} from "@workspace/api-client-react";

vi.mock("@workspace/api-client-react", () => ({
  useListProducts: vi.fn(),
  useGetCatalogStats: vi.fn(),
  useGetMe: vi.fn(),
  useListOrders: vi.fn(),
  getListProductsQueryKey: (params: unknown) => ["/api/products", params],
  getGetCatalogStatsQueryKey: () => ["/api/catalog-stats"],
  getGetMeQueryKey: () => ["/api/auth/me"],
  getListOrdersQueryKey: (params: unknown) => ["/api/orders", params],
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ token: null }),
}));

vi.mock("@/hooks/useSeo", () => ({
  useSeo: () => null,
}));

function mockHooks() {
  vi.mocked(useListProducts).mockReturnValue({
    data: [],
    isLoading: false,
    isError: false,
    isPlaceholderData: false,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useListProducts>);
  vi.mocked(useGetCatalogStats).mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useGetCatalogStats>);
  vi.mocked(useGetMe).mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useGetMe>);
  vi.mocked(useListOrders).mockReturnValue({
    data: [],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useListOrders>);
}

function renderPage() {
  return render(
    <Router>
      <HomePage />
    </Router>,
  );
}

function setUrl(pathAndQuery: string) {
  window.history.replaceState(null, "", pathAndQuery);
}

describe("HomePage — catalog filters ↔ URL (R98-04 + F-16)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHooks();
    setUrl("/");
  });
  afterEach(() => {
    setUrl("/");
  });

  it("mounts with ?category/sort/available_only/search applied to chips, select and the products query", () => {
    setUrl("/?search=نتفلكس&category=software&sort=price_asc&available_only=true");

    renderPage();

    // The search box is pre-filled with the committed query.
    expect(screen.getByLabelText("البحث في المنتجات")).toHaveValue("نتفلكس");
    // The category chip is pressed (R134 A2-F1: canonical label).
    expect(screen.getByRole("button", { name: "برامج وتراخيص" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // The availability chip is pressed.
    expect(screen.getByRole("button", { name: "متوفر فقط" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // The sort select carries the URL value.
    expect(screen.getByLabelText("ترتيب المنتجات")).toHaveValue("price_asc");
    // And the products query received the exact filter set (fields:list
    // is the A2-F3 grid projection every catalog fetch carries).
    const firstCall = vi.mocked(useListProducts).mock.calls[0]!;
    expect(firstCall[0]).toEqual({
      search: "نتفلكس",
      category: "software",
      sort: "price_asc",
      available_only: "true",
      fields: "list",
    });
  });

  it("changing a filter mirrors it into the querystring via replaceState", async () => {
    const replaceSpy = vi.spyOn(window.history, "replaceState");
    renderPage();

    // Click a category chip… (R161-C: «موسيقى وصوتيات» — the music
    // chip derives from categoryLabel, re-pinned with the honest
    // audio-wide family label)
    fireEvent.click(screen.getByRole("button", { name: "موسيقى وصوتيات" }));
    await waitFor(() => {
      const url = replaceSpy.mock.calls.at(-1)?.[2];
      expect(String(url)).toMatch(/^\/\?category=music$/);
    });

    // …type a search and commit it with Enter (same state path as the
    // 320ms debounce landing).
    const input = screen.getByLabelText("البحث في المنتجات");
    fireEvent.change(input, { target: { value: "سبوتيفاي" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => {
      // jsdom encodes the Arabic query value in the URL string — match the
      // param shape, then assert the decoded value via location below.
      const url = replaceSpy.mock.calls.at(-1)?.[2];
      expect(String(url)).toMatch(/^\/\?search=[^&]+&category=music$/);
    });
    // The live URL actually carries the filters (shared-link case).
    expect(window.location.search).toContain("category=music");
    expect(window.location.search).toContain(
      "search=%D8%B3%D8%A8%D9%88%D8%AA%D9%8A%D9%81%D8%A7%D9%8A",
    );
    replaceSpy.mockRestore();
  });

  it("clearing filters strips the querystring back to the bare path", async () => {
    setUrl("/?category=software");
    const replaceSpy = vi.spyOn(window.history, "replaceState");
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "برامج وتراخيص" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });

    // مسح (1) — the clear-all affordance in the result header (the empty
    // state's "مسح جميع الفلاتر" is a separate button for a separate state).
    fireEvent.click(screen.getByRole("button", { name: "مسح (1)" }));
    await waitFor(() => {
      const url = replaceSpy.mock.calls.at(-1)?.[2];
      expect(String(url)).toBe("/");
    });
    replaceSpy.mockRestore();
  });

  it("whitelists bogus category/sort values instead of blanking the select", () => {
    setUrl("/?category=hacking&sort=cheapest");

    renderPage();

    expect(screen.getByLabelText("ترتيب المنتجات")).toHaveValue("");
    // No category chip is armed (R134 A2-F1: canonical labels —
    // home.tsx derives from categoryLabel()). R161-C: streaming/music
    // ride the honest taxonomy labels.
    for (const label of [
      "الكل",
      "منصات المشاهدة",
      "موسيقى وصوتيات",
      "برامج وتراخيص",
      "شبكات VPN",
      "أدوات ذكاء اصطناعي",
      "أدوات SEO",
      "تعليم ومكتبات",
    ]) {
      expect(screen.getByRole("button", { name: label })).toHaveAttribute(
        "aria-pressed",
        label === "الكل" ? "true" : "false",
      );
    }
    // The products query got the sanitized (empty) filters — plus the
    // always-on A2-F3 list projection flag.
    expect(vi.mocked(useListProducts).mock.calls[0]![0]).toEqual({ fields: "list" });
  });

  it("hands the products query placeholderData: keepPreviousData (r97 F-16 — no skeleton flash on filter change)", () => {
    renderPage();
    const options = vi.mocked(useListProducts).mock.calls[0]![1] as {
      query?: { placeholderData?: unknown };
    };
    // Identity against TanStack v5's exported sentinel — the REAL module
    // (only @workspace/api-client-react is mocked here).
    expect(options.query?.placeholderData).toBe(keepPreviousData);
  });
});

// ── L4-3 (R143): the available-first re-sort is BROWSE-only ─────────────────
// The client-side re-order keyed on `sort` alone, so every no-explicit-sort
// SEARCH view was re-sorted by availability — silently overriding the
// backend's relevance tiers (tier 0 compound → tier 1 prefix → tier 2): a
// loosely-matching stocked product jumped above exact brand matches. The
// نفد-first UX concern is a browsing problem; a searcher's intent ordering
// is the relevance tiers.
describe("HomePage — displayProducts re-sort gating (L4-3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHooks();
    setUrl("/");
  });
  afterEach(() => {
    setUrl("/");
  });

  /** Mixed-availability catalog in SERVER order: the نفد exact match
   * leads, the stocked loose match trails (the tier system's verdict). */
  const relevanceOrder = [
    { id: 1, name: "Netflix Family", is_available: false },
    { id: 2, name: "Netflix Basic", is_available: false },
    { id: 3, name: "Month Plan VPN", is_available: true },
    { id: 4, name: "Netflix Standard", is_available: true },
  ];

  function mockProductsList(rows: Array<{ id: number; name: string; is_available: boolean }>) {
    vi.mocked(useListProducts).mockReturnValue({
      data: rows.map((r) => ({
        id: r.id,
        slug: `p-${r.id}`,
        name: r.name,
        image_url: null,
        price: 25,
        category: "streaming",
        is_available: r.is_available,
        stock_count: r.is_available ? 5 : 0,
      })),
      isLoading: false,
      isError: false,
      isPlaceholderData: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useListProducts>);
  }

  function gridOrder(): string[] {
    // The ProductCard h3s — DOM order is the rendered grid order.
    return screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent?.trim() ?? "");
  }

  /** ProductCard rides useCartCommands — the grid needs the real
   * CartProvider (localStorage-backed; empty cart by default). */
  function renderWithCart() {
    return render(
      <Router>
        <CartProvider>
          <HomePage />
        </CartProvider>
      </Router>,
    );
  }

  it("a SEARCH result set keeps the server's relevance order (no available-first override)", () => {
    mockProductsList(relevanceOrder);
    setUrl("/?search=netflix");

    renderWithCart();

    // Exact (نفد) brand matches keep their tier-0/1 lead — the re-sort
    // must NOT promote the stocked loose match above them.
    expect(gridOrder()).toEqual([
      "Netflix Family",
      "Netflix Basic",
      "Month Plan VPN",
      "Netflix Standard",
    ]);
  });

  it("the DEFAULT browse view still fronts available products (R120-B1 unchanged)", () => {
    mockProductsList(relevanceOrder);

    renderWithCart();

    // Browse mode: stocked cards lead (stably — server order within
    // each availability group).
    expect(gridOrder()).toEqual([
      "Month Plan VPN",
      "Netflix Standard",
      "Netflix Family",
      "Netflix Basic",
    ]);
  });

  it("an explicit sort keeps the server order for BOTH browse and search (the pre-L4-3 contract)", () => {
    mockProductsList(relevanceOrder);
    setUrl("/?search=netflix&sort=price_asc");

    renderWithCart();

    expect(gridOrder()).toEqual([
      "Netflix Family",
      "Netflix Basic",
      "Month Plan VPN",
      "Netflix Standard",
    ]);
  });
});
