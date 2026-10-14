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
 *   • R147 (2-b): the products section header carries ONE honest
 *     availability line — the real in-stock count with CategoryRail's
 *     success-dot idiom on mixed stock, a muted ongoing-restock notice
 *     (never a dated promise) when the whole category is نفد, and
 *     nothing at all while loading.
 *
 * `@workspace/api-client-react` is mocked at the module boundary (the
 * vitest config's documented pattern for page-level component tests);
 * the slug arrives through a real wouter Route match (the
 * product-legacy-shape idiom). ProductCard rides useCartCommands, so
 * the render harness wraps the real CartProvider (home-filters-url
 * idiom — localStorage-backed, empty cart by default).
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { Router, Route } from "wouter";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CategoryPage from "@/pages/category";
import { CartProvider } from "@/lib/cart";
import { useListProducts } from "@workspace/api-client-react";

vi.mock("@workspace/api-client-react", () => ({
  useListProducts: vi.fn(),
  getListProductsQueryKey: (params: unknown) => ["/api/products", params],
}));

vi.mock("@/hooks/useSeo", () => ({
  useSeo: () => null,
}));

const refetchMock = vi.fn();

function mockProducts(over: { isError?: boolean; isLoading?: boolean; data?: unknown[] }) {
  vi.mocked(useListProducts).mockReturnValue({
    data: over.data ?? [],
    isLoading: over.isLoading ?? false,
    isError: over.isError ?? false,
    refetch: refetchMock,
  } as unknown as ReturnType<typeof useListProducts>);
}

function renderCategory(slug = "streaming") {
  window.history.pushState({}, "", `/category/${slug}`);
  return render(
    <Router>
      {/* CartProvider: ProductCard's useCartCommands needs it once the
          availability suite mounts real cards (home-filters-url idiom). */}
      <CartProvider>
        <Route path="/category/:slug" component={CategoryPage} />
      </CartProvider>
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
    // An empty category is NOT a sold-out category — no availability line.
    expect(screen.queryByText(/متاح الآن للشراء الفوري/)).not.toBeInTheDocument();
    expect(screen.queryByText(/نفدت مؤقتاً/)).not.toBeInTheDocument();
  });
});

// ── R147 (2-b): the availability truth line ─────────────────────────────────
// Production ran 44/45 sold out; the landing gave a Google shopper a wall
// of نفد cards and zero orientation. The line is computed from the
// UNFILTERED array (the home categoryHasStock truth rule) — the grid's
// available-first sort must never bend the number.
describe("CategoryPage — availability truth line (R147 2-b)", () => {
  /** A list-endpoint-shaped row (jsonld-completeness LIST_PRODUCT shape). */
  const row = (id: number, is_available: boolean) => ({
    id,
    slug: `p-${id}`,
    name: `منتج ${id}`,
    image_url: null,
    price: 25,
    category: "streaming",
    is_available,
    stock_count: is_available ? 5 : 0,
  });

  it("mixed stock → the success-dot line carries the REAL in-stock count (CategoryRail idiom)", () => {
    mockProducts({ data: [row(1, true), row(2, false), row(3, true), row(4, false)] });
    renderCategory();

    const line = screen.getByText(/متاح الآن للشراء الفوري/);
    expect(line).toHaveTextContent("متاح الآن للشراء الفوري: 2");
    // The CategoryRail byte-twin classes: success ink + the 1.5px dot.
    expect(line.className).toContain("text-status-success");
    const dot = line.querySelector('span[aria-hidden="true"]');
    expect(dot?.className).toBe("w-1.5 h-1.5 rounded-full bg-status-success");
    // The count rides tabular-nums (the money/count register).
    expect(line.querySelector(".tabular-nums")?.textContent).toBe("2");
    // No restock notice alongside a real count.
    expect(screen.queryByText(/نفدت مؤقتاً/)).not.toBeInTheDocument();
  });

  it("all sold out → the honest muted notice, never a fabricated restock promise", () => {
    mockProducts({ data: [row(1, false), row(2, false), row(3, false)] });
    renderCategory();

    const notice = screen.getByText("كل منتجات هذه الفئة نفدت مؤقتاً — يتجدّد المخزون باستمرار");
    expect(notice.className).toContain("text-muted-foreground");
    expect(screen.queryByText(/متاح الآن للشراء الفوري/)).not.toBeInTheDocument();
  });

  it("loading → no line at all (the count appears with data, not a guess)", () => {
    mockProducts({ isLoading: true, data: [row(1, true)] });
    renderCategory();

    expect(screen.queryByText(/متاح الآن للشراء الفوري/)).not.toBeInTheDocument();
    expect(screen.queryByText(/نفدت مؤقتاً/)).not.toBeInTheDocument();
  });
});
