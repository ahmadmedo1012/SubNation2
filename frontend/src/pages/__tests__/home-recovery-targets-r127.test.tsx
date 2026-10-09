/**
 * R127-L6 — home recovery-control tap floors + search-heading direction.
 *
 * B13 F-2 (P3): the page's last two inline recovery controls sat under
 * the app's own 44px floor while every page-level sibling had already
 * been lifted (R124-A4 tap batch, R125 B-4, home's own FetchErrorCard
 * retry at :1187+ min-h-11):
 *   • the orders-strip outage retry (~34px: text-xs + py-1.5 + border)
 *     → min-h-11 + -my-2 (the recent-searches «مسح» negative-margin
 *     idiom — floor met, strip row rhythm kept),
 *   • the filtered-empty «مسح جميع الفلاتر» CTA (~38px: text-sm +
 *     py-2 + border) → plain min-h-11 (standalone inside the py-16
 *     empty state — nothing to rhythm-compensate).
 *
 * A9-m2: the search-results h2 interpolates the raw searchInput; both
 * heading variants carry dir="auto" now so a Latin-digit or
 * bidi-confusable query cannot garble the heading direction.
 *
 * Harness mirrors home-filters-url.test.tsx (api hooks mocked at the
 * module boundary; URL state via history.replaceState).
 */

import { render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HomePage from "@/pages/home";
import {
  useGetCatalogStats,
  useGetMe,
  useListOrders,
  useListProducts,
} from "@workspace/api-client-react";

const useAuthMock = vi.hoisted(() => vi.fn(() => ({ token: null as string | null })));

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
  useAuth: useAuthMock,
}));

vi.mock("@/hooks/useSeo", () => ({
  useSeo: () => null,
}));

function mockHooks(overrides?: {
  orders?: Partial<ReturnType<typeof useListOrders>>;
  me?: Partial<ReturnType<typeof useGetMe>>;
}) {
  vi.mocked(useListProducts).mockReturnValue({
    data: [],
    isLoading: false,
    isError: false,
    isPlaceholderData: false,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useListProducts>);
  vi.mocked(useGetCatalogStats).mockReturnValue({
    data: undefined,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useGetCatalogStats>);
  vi.mocked(useGetMe).mockReturnValue({
    data: undefined,
    isError: false,
    ...overrides?.me,
  } as unknown as ReturnType<typeof useGetMe>);
  vi.mocked(useListOrders).mockReturnValue({
    data: [],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
    ...overrides?.orders,
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

describe("home — B13 F-2: the last two sub-44px recovery controls reach the tap floor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setUrl("/");
  });
  afterEach(() => {
    setUrl("/");
  });

  it("the orders-strip outage retry carries min-h-11 + the -my-2 rhythm idiom", () => {
    useAuthMock.mockReturnValue({ token: "test-token" });
    mockHooks({
      // Authed hero renders so /me resolves; the strip query errors so
      // the compact outage row + retry render.
      me: { data: { wallet_balance: 100, loyalty_points: 50 } },
      orders: { isError: true },
    });

    renderPage();

    const retry = screen.getByRole("button", { name: "إعادة المحاولة" });
    expect(retry.className).toContain("min-h-11");
    // Negative-margin idiom: the VISIBLE box is 44px (tap floor met),
    // while the row's geometry stays at its pre-fix rhythm.
    expect(retry.className).toContain("-my-2");
    // The pre-fix literals never come back.
    expect(retry.className).not.toMatch(/(^|\s)py-1\.5(\s|$)/);
  });

  it("the filtered-empty «مسح جميع الفلاتر» CTA carries min-h-11", () => {
    useAuthMock.mockReturnValue({ token: null });
    mockHooks();

    // A committed search arms activeFilterCount with zero products →
    // the filtered-empty state (not the catalog-empty branch).
    setUrl("/?search=netflix");
    renderPage();

    const cta = screen.getByRole("button", { name: "مسح جميع الفلاتر" });
    expect(cta.className).toContain("min-h-11");
    expect(cta.className).not.toMatch(/(^|\s)py-2(\s|$)/);
  });
});

describe("home — A9-m2: the search-results heading carries dir=auto", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthMock.mockReturnValue({ token: null });
    mockHooks();
  });
  afterEach(() => {
    setUrl("/");
  });

  it("the FILTERED (visible) heading interpolates the query under dir=auto", () => {
    setUrl("/?search=netflix");
    renderPage();

    const heading = screen.getByRole("heading", { name: /نتائج البحث/ });
    expect(heading).toHaveAttribute("dir", "auto");
    expect(heading.textContent).toContain("netflix");
  });

  it("the default (sr-only) heading also carries dir=auto", () => {
    setUrl("/");
    renderPage();

    const heading = screen.getByRole("heading", { name: "الاشتراكات المتاحة" });
    expect(heading).toHaveAttribute("dir", "auto");
  });
});
