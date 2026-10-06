/**
 * R118-B2 (A2 fix, buyer side) — decrypt_failed honesty on buyer surfaces.
 *
 * The backend sets `decrypt_failed: true` on a COMPLETED buyer order whose
 * raw credential columns are populated but undecryptable with the current
 * ENCRYPTION_KEY (every safeDecrypt returned null → delivered_* are null).
 * Before this fix both buyer surfaces implied "no credentials":
 *
 *  order-detail.tsx — a completed order with null delivered_* fell through
 *    to the «قيد الإعداد» ("being prepared") card, promising a delivery
 *    that will never arrive. The fix renders an honest warning card
 *    («تعذّر فك تشفير بيانات التسليم») + a support CTA instead.
 *
 *  product.tsx purchase-success receipt — the credentials box was simply
 *    omitted, implying the product ships without account data. The fix
 *    renders the same honest notice in the credentials slot.
 *
 * These tests pin both directions on both surfaces:
 *   • flag + null delivered fields → the honest message renders and the
 *     misleading state («قيد الإعداد» / bare receipt) does NOT;
 *   • flag absent → the normal render is untouched (preparing state for a
 *     pending order; credentials box for a delivered one).
 *
 * `@workspace/api-client-react` is mocked at the module boundary (the
 * vitest config's documented pattern for page-level component tests).
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Route, Router } from "wouter";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OrderDetailPage from "@/pages/order-detail";
import ProductPage from "@/pages/product";
import { useGetOrder } from "@workspace/api-client-react";

const createOrderMock = vi.fn();
const getProductMock = vi.fn();
const getMeMock = vi.fn(async () => ({ id: 7, wallet_balance: 51 }));
const refetchMock = vi.fn();

vi.mock("@workspace/api-client-react", () => ({
  useGetOrder: vi.fn(),
  getGetOrderQueryKey: (code: string) => [`/api/orders/${code}`],
  // R104: order-detail rides the shared /api/auth/me cache for its
  // page-scoped socket identity; the product page's /me refresh reads
  // the post-charge balance.
  useGetMe: () => ({ data: { id: 7, wallet_balance: 51 }, isLoading: false }),
  getGetMeQueryKey: () => ["/api/auth/me"],
  // Product-page buy path (success receipt).
  createOrder: (...args: unknown[]) => createOrderMock(...(args as [])),
  getProduct: (...args: unknown[]) => getProductMock(...(args as [])),
  getMe: () => getMeMock(),
  getGetWalletQueryKey: () => ["/api/wallet"],
  getListOrdersQueryKey: () => ["/api/orders"],
  getGetProductQueryKey: (id: number) => [`/api/products/${id}`],
  getGetProductRecommendationsQueryKey: (id: number) => [`/api/products/${id}/recommendations`],
  useGetProduct: () => ({
    // Lazy read (the established product-test pattern): the arrow body
    // evaluates at render time, after the module's consts initialized.
    data: SIMPLE_PRODUCT,
    isLoading: false,
    isError: false,
    error: null,
    refetch: refetchMock,
  }),
  useGetProductRecommendations: () => ({ data: [], isLoading: false, isError: false }),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

vi.mock("@/lib/cart", () => ({
  useCart: () => ({ addItem: vi.fn() }),
}));

const toastSpy = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastSpy }),
  // use-socket (imported by order-detail) imports the bare `toast`.
  toast: toastSpy,
}));

/** Completed order whose credentials failed every decrypt — the exact
 *  backend decrypt_failed contract (delivered_* all null, flag true). */
const DECRYPT_FAILED_ORDER = {
  id: 91,
  order_code: "SNDB91KEY",
  product_id: 3,
  product_name: "Netflix شهر",
  product_image_url: null,
  variant_id: null,
  status: "completed",
  amount: 160,
  created_at: "2026-10-01T12:00:00.000Z",
  delivered_email: null,
  delivered_password: null,
  delivered_extra_details: null,
  delivered_usage_terms: null,
  discount_amount: 0,
  coupon_code: null,
  decrypt_failed: true,
};

/** Same shape WITHOUT the flag — a still-processing order must keep the
 *  normal «قيد الإعداد» state. */
const PENDING_ORDER = {
  ...DECRYPT_FAILED_ORDER,
  order_code: "SNDB92WAIT",
  status: "pending",
  decrypt_failed: undefined,
};

/** Completed order with decrypted credentials and no flag — normal render. */
const DELIVERED_ORDER = {
  ...DECRYPT_FAILED_ORDER,
  order_code: "SNDB93OK",
  delivered_email: "buyer@example.com",
  delivered_password: "hunter2",
  decrypt_failed: undefined,
};

/** Simple variant-less product for the buy path (product-price-honesty
 *  harness shape — the page's own useGetProduct serves it). */
const SIMPLE_PRODUCT = {
  id: 5,
  slug: null,
  name: "Netflix شهر",
  description: "اشتراك شهري",
  category: "streaming",
  price: 49,
  price_from: false,
  sale_price: null,
  image_url: null,
  is_active: true,
  is_available: true,
  stock_count: 12,
  discount_percent: null,
  usage_terms: null,
  order_count: 0,
};

beforeEach(() => {
  vi.mocked(useGetOrder).mockReset();
  createOrderMock.mockReset();
  getProductMock.mockReset();
  getMeMock.mockClear();
  refetchMock.mockReset();
  toastSpy.mockReset();
  localStorage.clear();
});

describe("OrderDetailPage — decrypt_failed honesty (R118-B2 / A2)", () => {
  function renderDetail(order: typeof DECRYPT_FAILED_ORDER) {
    vi.mocked(useGetOrder).mockReturnValue({
      data: order,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useGetOrder>);

    window.history.pushState({}, "", `/orders/${order.order_code}`);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return render(
      <QueryClientProvider client={queryClient}>
        <Router>
          <OrderDetailPage />
        </Router>
      </QueryClientProvider>,
    );
  }

  it("flag + null delivered fields: the honest decrypt-failure card renders — NOT «قيد الإعداد»", () => {
    renderDetail(DECRYPT_FAILED_ORDER);

    expect(screen.getByText("تعذّر فك تشفير بيانات التسليم")).toBeInTheDocument();
    // The misleading "still being prepared" promise must not appear.
    expect(screen.queryByText("قيد الإعداد")).not.toBeInTheDocument();
    expect(
      screen.queryByText(/سيتم تسليم بيانات الحساب فور اكتمال الطلب/),
    ).not.toBeInTheDocument();
  });

  it("the honest card links to support with the order code as ?ref", () => {
    renderDetail(DECRYPT_FAILED_ORDER);

    // The page's bottom support link («مشكلة في هذا الطلب؟…») also matches
    // the label regex — scope to the one carrying the order-code ?ref.
    const supportLinks = screen.getAllByRole("link", {
      name: /تواصل مع الدعم/,
    }) as HTMLAnchorElement[];
    expect(supportLinks.length).toBeGreaterThan(0);
    const cardLink = supportLinks.find((a) => a.getAttribute("href") === "/support?ref=SNDB91KEY");
    expect(cardLink).toBeDefined();
  });

  it("without the flag: a pending order keeps the normal «قيد الإعداد» state", () => {
    renderDetail(PENDING_ORDER);

    expect(screen.getByText("قيد الإعداد")).toBeInTheDocument();
    expect(screen.queryByText("تعذّر فك تشفير بيانات التسليم")).not.toBeInTheDocument();
  });

  it("without the flag: a delivered order renders its credentials normally", () => {
    renderDetail(DELIVERED_ORDER);

    expect(screen.getByText("البريد الإلكتروني")).toBeInTheDocument();
    expect(screen.getByText("buyer@example.com")).toBeInTheDocument();
    expect(screen.queryByText("تعذّر فك تشفير بيانات التسليم")).not.toBeInTheDocument();
  });
});

describe("ProductPage success receipt — decrypt_failed honesty (R118-B2 / A2)", () => {
  function renderProductPage() {
    window.history.pushState({}, "", `/product/${SIMPLE_PRODUCT.id}`);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return render(
      <QueryClientProvider client={queryClient}>
        <Router>
          <Route path="/product/:slug" component={ProductPage} />
        </Router>
      </QueryClientProvider>,
    );
  }

  async function clickBuy() {
    const btn = await screen.findByRole("button", { name: /اشترِ الآن/ });
    await waitFor(() => expect(btn).toBeEnabled());
    await act(async () => {
      fireEvent.click(btn);
    });
  }

  it("flag + null delivered fields: the receipt shows the honest notice, not a silent gap", async () => {
    getProductMock.mockResolvedValueOnce(SIMPLE_PRODUCT);
    createOrderMock.mockResolvedValueOnce({
      order_code: "SNDB94KEY",
      amount: 49,
      delivered_email: null,
      delivered_password: null,
      delivered_extra_details: null,
      decrypt_failed: true,
    });
    renderProductPage();

    await clickBuy();

    expect(await screen.findByText("تم الشراء بنجاح!")).toBeInTheDocument();
    // The honest notice in the credentials slot…
    expect(screen.getByText("تعذّر فك تشفير بيانات التسليم")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /تواصل مع الدعم/ })).toBeInTheDocument();
    // …and NO empty «بيانات الحساب» credentials box (nothing to show).
    expect(screen.queryByText("بيانات الحساب")).not.toBeInTheDocument();
  });

  it("without the flag: delivered credentials render normally in the receipt", async () => {
    getProductMock.mockResolvedValueOnce(SIMPLE_PRODUCT);
    createOrderMock.mockResolvedValueOnce({
      order_code: "SNDB95OK",
      amount: 49,
      delivered_email: "buyer@example.com",
      delivered_password: "hunter2",
    });
    renderProductPage();

    await clickBuy();

    expect(await screen.findByText("تم الشراء بنجاح!")).toBeInTheDocument();
    expect(screen.getByText("بيانات الحساب")).toBeInTheDocument();
    expect(screen.getByText("buyer@example.com")).toBeInTheDocument();
    expect(screen.queryByText("تعذّر فك تشفير بيانات التسليم")).not.toBeInTheDocument();
  });
});
