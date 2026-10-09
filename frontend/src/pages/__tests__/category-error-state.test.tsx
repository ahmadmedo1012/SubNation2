/**
 * R125-I7 (A7 B-4) — category outage ≠ empty category.
 *
 * The category landing page's failed-load branch was a hand-rolled
 * outage card — a 7th drifted site the FetchErrorCard extraction's own
 * ledger never listed (it predates the component's drift inventory),
 * shipping a native ~37px retry under the app-wide 44px tap floor.
 * It now renders the shared FetchErrorCard (the orders/flash-sales
 * page-family idiom), so this suite pins:
 *
 *   • a failed /api/products probe renders the SHARED card
 *     (role="alert", rounded-2xl) — never the empty-category state;
 *   • the retry is a Button at the 44px floor and actually refetches;
 *   • a healthy load with zero products still renders the honest
 *     empty state (error ≠ empty both ways).
 *
 * `@workspace/api-client-react` is mocked at the module boundary (the
 * vitest config's documented pattern for page-level component tests);
 * the slug arrives through a real wouter Route match (the
 * product-legacy-shape idiom).
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { Router, Route } from "wouter";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CategoryPage from "@/pages/category";
import { useListProducts } from "@workspace/api-client-react";

vi.mock("@workspace/api-client-react", () => ({
  useListProducts: vi.fn(),
  getListProductsQueryKey: (params: unknown) => ["/api/products", params],
}));

vi.mock("@/hooks/useSeo", () => ({
  useSeo: () => null,
}));

const refetchMock = vi.fn();

function mockProducts(over: { isError?: boolean; data?: unknown[] }) {
  vi.mocked(useListProducts).mockReturnValue({
    data: over.data ?? [],
    isLoading: false,
    isError: over.isError ?? false,
    refetch: refetchMock,
  } as unknown as ReturnType<typeof useListProducts>);
}

function renderCategory(slug = "streaming") {
  window.history.pushState({}, "", `/category/${slug}`);
  return render(
    <Router>
      <Route path="/category/:slug" component={CategoryPage} />
    </Router>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  refetchMock.mockReset();
  mockProducts({});
});

describe("CategoryPage — failed load renders the shared FetchErrorCard (R125-I7 / A7 B-4)", () => {
  it("an outage renders the shared card (role=alert, rounded-2xl) with a 44px retry — never the empty state", async () => {
    mockProducts({ isError: true });
    renderCategory();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("تعذّر تحميل منتجات الفئة");
    // The shared page-family shell — the hand-rolled card it replaced
    // had drifted off the family (native button, bespoke padding).
    expect(alert.className).toContain("rounded-2xl");

    const retry = screen.getByRole("button", { name: "إعادة المحاولة" });
    // The old native retry measured ~37px (px-5 py-2 + text-sm).
    expect(retry.className).toContain("min-h-11");

    // The outage must not read as "no products in this category".
    expect(screen.queryByText(/لا توجد منتجات في هذه الفئة/)).not.toBeInTheDocument();

    fireEvent.click(retry);
    expect(refetchMock).toHaveBeenCalledTimes(1);
  });

  it("a healthy zero-product load still renders the honest empty state (error ≠ empty, both ways)", () => {
    mockProducts({ data: [] });
    renderCategory();

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText(/لا توجد منتجات في هذه الفئة حالياً/)).toBeInTheDocument();
  });
});
