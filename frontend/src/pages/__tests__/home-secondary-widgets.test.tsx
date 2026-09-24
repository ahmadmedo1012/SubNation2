/**
 * R111-F1 G2/G3 (P3) — home secondary-widget state completeness.
 *
 * G2 — catalog-stats chips (desktop hero side column + guest mobile
 * strip): no loading state (a late success popped the chips in — CLS)
 * and no error state (an outage silently removed them). Contract now:
 * skeleton chips while `isPending`, content when loaded, and a
 * DELIBERATE silent hide on error (decorative secondary data — the
 * catalog grid below carries the page's honest error + retry).
 *
 * G3 — authenticated "آخر الطلبات" strip: no loading skeleton and no
 * error state — an outage read as "no orders". Contract now: a 4-row
 * mini-skeleton while `isPending`, the real strip when loaded, and a
 * compact muted error row with an «إعادة المحاولة» retry on failure.
 *
 * The api-client hooks are mocked at the module boundary (home-filters-
 * url test pattern); useSeo is stubbed out of jsdom.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

const refetchStatsMock = vi.fn();
const refetchOrdersMock = vi.fn();

function mockHooks(overrides?: {
  stats?: Partial<ReturnType<typeof useGetCatalogStats>>;
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
    refetch: refetchStatsMock,
    ...overrides?.stats,
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
    refetch: refetchOrdersMock,
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

// The desktop stats chip labels (count-aware via formatCount) — used in
// absence assertions. Kept explicit so the catalog section's sr-only
// «الاشتراكات المتاحة» heading never matches by accident.
const STATS_LABELS =
  /منتج متاح|منتجان متاحان|منتجات متاحة|منتجاً متاحاً|وحدات بالمخزون|وحدة بالمخزون/;

/** Every skeleton node currently on screen (no other widget is loading
 *  in these fixtures, so the count isolates the widget under test). */
function shimmerCount(container: HTMLElement): number {
  return container.querySelectorAll(".skeleton-shimmer").length;
}

describe("G2 — catalog-stats chips: skeleton → content / deliberate hide on error", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthMock.mockReturnValue({ token: null });
    mockHooks();
  });

  it("renders chip-shaped skeletons while the first fetch is pending (no silent pop-in)", () => {
    mockHooks({ stats: { isPending: true } });
    const { container } = renderPage();

    // Desktop column (3 chips × 2 bars) + guest mobile strip (3 cells ×
    // 2 bars) — 12 shimmer nodes, and zero real stat copy yet.
    expect(shimmerCount(container)).toBeGreaterThanOrEqual(12);
    expect(screen.queryByText(STATS_LABELS)).not.toBeInTheDocument();
    expect(screen.queryAllByText("أقل سعر")).toHaveLength(0);
  });

  it("renders the chips once stats land", () => {
    mockHooks({
      stats: { data: { available_products: 3, lowest_price: 10, total_units: 120 } },
    });
    const { container } = renderPage();

    // 3 → few form («منتجات متاحة») on the desktop column.
    expect(screen.getByText("3 منتجات متاحة")).toBeInTheDocument();
    // «أقل سعر» rides BOTH the desktop column and the guest mobile strip.
    expect(screen.getAllByText("أقل سعر")).toHaveLength(2);
    expect(shimmerCount(container)).toBe(0);
  });

  it("hides the strip on error — deliberate degrade for decorative data (documented, no fake zeros)", () => {
    mockHooks({ stats: { isError: true } });
    const { container } = renderPage();

    expect(shimmerCount(container)).toBe(0);
    expect(screen.queryByText(STATS_LABELS)).not.toBeInTheDocument();
    expect(screen.queryAllByText("أقل سعر")).toHaveLength(0);
  });
});

describe("G3 — «آخر الطلبات» strip: skeleton → content / honest error + retry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthMock.mockReturnValue({ token: "test-token" });
    // Authenticated hero: /me resolves so the authed branch renders.
    mockHooks({ me: { data: { wallet_balance: 100, loyalty_points: 50 } } });
  });

  it("renders a 4-row mini-skeleton while the orders query is pending (no pop-in CLS)", () => {
    mockHooks({
      orders: { isPending: true },
      me: { data: { wallet_balance: 100, loyalty_points: 50 } },
    });
    const { container } = renderPage();

    // Header (2 bars) + 4 rows × 4 bars = 18 shimmer nodes; the real
    // strip's «آخر الطلبات» header must not co-render with it.
    expect(shimmerCount(container)).toBeGreaterThanOrEqual(18);
    expect(screen.queryByText("آخر الطلبات")).not.toBeInTheDocument();
  });

  it("an outage renders the honest compact error row — never reads as «no orders»", () => {
    mockHooks({
      orders: { isError: true },
      me: { data: { wallet_balance: 100, loyalty_points: 50 } },
    });
    const { container } = renderPage();

    expect(screen.getByText("تعذّر تحميل آخر الطلبات")).toBeInTheDocument();
    expect(shimmerCount(container)).toBe(0);

    // Retry affordance rides the page's standard verb + actually refetches.
    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    expect(refetchOrdersMock).toHaveBeenCalledTimes(1);
  });

  it("an empty (loaded) history renders no strip and no error — the plain honest empty", () => {
    const { container } = renderPage();

    expect(screen.queryByText("آخر الطلبات")).not.toBeInTheDocument();
    expect(screen.queryByText("تعذّر تحميل آخر الطلبات")).not.toBeInTheDocument();
    expect(shimmerCount(container)).toBe(0);
  });
});
