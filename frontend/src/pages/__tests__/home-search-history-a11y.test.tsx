/**
 * R134 (A2-F3) — the home search-history dropdown's disclosure + listbox
 * semantics.
 *
 * The keyboard behavior was already correct (R94-A1 #16: the
 * relatedTarget blur guard keeps focus in the control; min-h-11 rows)
 * — but the popup was ARIA-silent: a screen reader got no announcement
 * that a list had opened. The fix follows the repo's own disclosure
 * idiom (support.tsx) plus listbox option semantics:
 *
 *   1. The search input carries aria-expanded / aria-controls /
 *      aria-autocomplete="list" — the popup's presence is announced.
 *   2. ONLY the suggestion rows live in the role="listbox" container
 *      (the header + مسح button stay siblings); each row is an
 *      aria-selected="false" option.
 *   3. The closed state reads aria-expanded="false" (with history
 *      present, the popup hidden).
 *
 * The api-client hooks are mocked at the module boundary (the
 * home-filters-url test pattern); useSeo is stubbed for jsdom.
 */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Router } from "wouter";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

describe("HomePage — search-history dropdown semantics (R134 A2-F3)", () => {
  beforeEach(() => {
    mockHooks();
    window.history.replaceState(null, "", "/");
    localStorage.setItem("subnation_search_history", JSON.stringify(["نتفلكس", "شاهد"]));
  });

  it("the focused input announces the popup: expanded + controls + autocomplete=list", () => {
    renderPage();

    const input = screen.getByLabelText("البحث في المنتجات");
    // Closed on mount (history present but the control unfocused).
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(input).toHaveAttribute("aria-controls", "home-search-history");
    expect(input).toHaveAttribute("aria-autocomplete", "list");

    // Focus opens the history popup (empty input + stored history).
    fireEvent.focus(input);

    expect(input).toHaveAttribute("aria-expanded", "true");
    const listbox = screen.getByRole("listbox", { name: "عمليات البحث السابقة" });
    expect(listbox).toHaveAttribute("id", "home-search-history");

    // The suggestions are options — and ONLY the rows: the «مسح» button
    // stays a sibling of the listbox, not a child of it. Scoped to the
    // listbox: the sort <select> beside the search box also carries
    // native <option>s.
    const options = within(listbox).getAllByRole("option");
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveTextContent("نتفلكس");
    expect(options[0]).toHaveAttribute("aria-selected", "false");
    expect(listbox).not.toContainElement(screen.getByRole("button", { name: "مسح" }));
  });

  it("blur outside the control collapses the popup back to aria-expanded=false", async () => {
    renderPage();

    const input = screen.getByLabelText("البحث في المنتجات");
    fireEvent.focus(input);
    expect(input).toHaveAttribute("aria-expanded", "true");

    // Focus leaves the whole search control (to <body>) — the 200ms
    // blur guard closes the dropdown.
    fireEvent.blur(input, { relatedTarget: document.body });

    await waitFor(() => {
      expect(input).toHaveAttribute("aria-expanded", "false");
    });
    // Scoped to the popup's own listbox (the sort <select> carries
    // native options that must NOT read as suggestion rows).
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    const stillMounted = document.getElementById("home-search-history");
    expect(stillMounted).toBeNull();
  });
});
