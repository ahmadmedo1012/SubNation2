/**
 * 98-F2 (R98-A3 F5 / P2) — checkout mount-time live-price reconciliation.
 *
 * Cart lines carry PRICE SNAPSHOTS taken at add-to-cart time
 * (lib/cart.tsx) and the checkout page used to mount with only a balance
 * probe — a flash sale ending between add and confirm had the shopper
 * approve «80.00 د.ل» while every unit charged the live 100.00 (the
 * server prices from live rows; the snapshot is display-only).
 *
 * These tests pin the re-quote contract on checkout mount (before the
 * confirm CTA unlocks):
 *
 *   1. price changed → the cart store line is re-priced (quantity
 *      untouched), the summary totals follow (line total, subtotal AND
 *      grand total all carry the live number), and the ONE subtle
 *      notice «تم تحديث الأسعار حسب الأسعار الحالية» appears;
 *   2. product archived (404) or deactivated (is_active:false) or the
 *      selected variant gone (VARIANT_NOT_FOUND server-side) → the line
 *      is DROPPED with its own notice (rendered even when the drop
 *      empties the whole cart — otherwise it would silently vanish),
 *      cart storage follows;
 *   3. no change → silent (no notices, totals keep the snapshot).
 *
 * `@workspace/api-client-react` is mocked at the module boundary (the
 * vitest config's documented pattern); the cart rides the REAL
 * CartProvider seeded via localStorage; /api/auth/me rides a global
 * fetch stub.
 */

import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CheckoutPage from "@/pages/checkout";
import { CartProvider, type LocalCartItem } from "@/lib/cart";

const createOrderMock = vi.fn();
const getMeMock = vi.fn(async () => ({ wallet_balance: 1_000_000 }));
const getProductMock = vi.fn();

vi.mock("@workspace/api-client-react", () => ({
  createOrder: (...args: unknown[]) => createOrderMock(...(args as [])),
  getGetMeQueryKey: () => ["/api/auth/me"],
  getGetWalletQueryKey: () => ["/api/wallet"],
  getListOrdersQueryKey: () => ["/api/orders"],
  // R116-S2 (P3): the balance rides the seeded useGetMe cache now —
  // solvent by default so the confirm CTA stays enabled.
  useGetMe: vi.fn(() => ({
    data: { id: 7, wallet_balance: 1_000_000 },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  })),
  getMe: (...args: unknown[]) => getMeMock(...(args as [])),
  getProduct: (...args: unknown[]) => getProductMock(...(args as [])),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

const toastSpy = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastSpy }),
}));

const CART_ITEM: LocalCartItem = {
  productId: 5,
  variantId: 101,
  variantLabel: "شهر واحد",
  slug: "netflix-1m",
  name: "Netflix شهر",
  imageUrl: null,
  priceLYD: 75,
  salePriceLYD: 49, // flash-sale snapshot at add time
  discountPercent: 35,
  quantity: 2,
};

function seedCart() {
  localStorage.setItem("subnation_cart_v2", JSON.stringify([CART_ITEM]));
}

function readCart(): LocalCartItem[] {
  const raw = localStorage.getItem("subnation_cart_v2");
  return raw ? (JSON.parse(raw) as LocalCartItem[]) : [];
}

/** ApiError-shaped rejection — the page detects archived products via
 * `error.name === "ApiError" && status === 404`. */
function httpApiError(error: string, status: number) {
  return Object.assign(new Error(error), {
    name: "ApiError",
    status,
    data: { error, code: "NOT_FOUND" },
  });
}

/** A live /api/products/:id payload for the seeded line. */
function liveProduct(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 5,
    slug: "netflix-1m",
    name: "Netflix شهر",
    price: 75,
    price_from: false,
    sale_price: 49,
    discount_percent: 35,
    is_active: true,
    is_available: true,
    stock_count: 12,
    order_count: 0,
    variants: [
      {
        id: 101,
        plan_label: null,
        duration_label: "شهر واحد",
        label: "شهر واحد",
        price: 75,
        sale_price: 49,
        discount_percent: 35,
        is_available: true,
      },
    ],
    ...over,
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Router>
        <CartProvider>
          <CheckoutPage />
        </CartProvider>
      </Router>
    </QueryClientProvider>,
  );
}

const PRICE_NOTICE = "تم تحديث الأسعار حسب الأسعار الحالية";

beforeEach(() => {
  createOrderMock.mockReset();
  getMeMock.mockClear();
  getProductMock.mockReset();
  toastSpy.mockReset();
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ wallet_balance: 1_000_000 }),
    })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CheckoutPage — mount-time live-price re-quote (98-F2 / R98-A3 F5 P2)", () => {
  it("flash sale ended: re-prices the line, updates totals + storage, shows the notice ONCE", async () => {
    seedCart();
    // Live catalog: the sale is GONE — variant 101 now lists at full 75.
    getProductMock.mockResolvedValue(
      liveProduct({
        sale_price: null,
        discount_percent: null,
        variants: [
          {
            id: 101,
            plan_label: null,
            duration_label: "شهر واحد",
            label: "شهر واحد",
            price: 75,
            sale_price: null,
            discount_percent: null,
            is_available: true,
          },
        ],
      }),
    );
    renderPage();

    // Snapshot subtotal (49 × 2 = 98) flips to the live 75 × 2 = 150 —
    // the line total, the subtotal, the grand total and the CTA each
    // render the number in their OWN element, so query with *AllBy*.
    const liveTotals = await screen.findAllByText("150.00 د.ل");
    expect(liveTotals.length).toBeGreaterThanOrEqual(3);
    // …and the snapshot number is gone everywhere.
    await waitFor(() => expect(screen.queryByText("98.00 د.ل")).not.toBeInTheDocument());
    // …and the single subtle notice explains WHY.
    expect(await screen.findByText(PRICE_NOTICE)).toBeInTheDocument();
    expect(screen.getAllByText(PRICE_NOTICE)).toHaveLength(1);

    // The cart store (and localStorage) carry the live snapshot; quantity untouched.
    const line = readCart()[0];
    expect(line).toEqual(
      expect.objectContaining({
        priceLYD: 75,
        salePriceLYD: null,
        discountPercent: null,
        quantity: 2,
      }),
    );

    // The CTA sells the LIVE total.
    const cta = await screen.findByRole("button", { name: /إتمام الطلب/ });
    await waitFor(() => expect(cta.textContent).toContain("150.00 د.ل"));
    expect(cta).toBeEnabled();
    // No line was dropped.
    expect(screen.queryByText(/أُزيل من الطلب/)).not.toBeInTheDocument();
  });

  it("product archived (404): drops the line with its own notice and empties the cart", async () => {
    seedCart();
    getProductMock.mockRejectedValue(httpApiError("المنتج غير موجود", 404));
    renderPage();

    await waitFor(() => expect(screen.getByText("سلتك فارغة")).toBeInTheDocument());
    expect(await screen.findByText(/لم يعد متاحاً للشراء — أُزيل من الطلب/)).toBeInTheDocument();
    expect(screen.getByText(/Netflix شهر/)).toBeInTheDocument(); // the notice names the line
    expect(readCart()).toHaveLength(0);
    // R120-B7 (A4-F1 completion): the empty-state CTA is ONE anchor
    // wearing the button styling (asChild composition) — no nested
    // button, no doubled tab stop.
    const cta = screen.getByRole("link", { name: "تصفح المنتجات" });
    expect(cta).toHaveAttribute("href", "/");
    expect(cta.querySelector("button")).toBeNull();
    // The price-update notice must NOT appear (this was a drop, not a reprice).
    expect(screen.queryByText(PRICE_NOTICE)).not.toBeInTheDocument();
  });

  it("product deactivated (is_active: false): dropped the same way (checkout refuses it server-side)", async () => {
    seedCart();
    getProductMock.mockResolvedValue(liveProduct({ is_active: false }));
    renderPage();

    await waitFor(() => expect(screen.getByText("سلتك فارغة")).toBeInTheDocument());
    expect(await screen.findByText(/لم يعد متاحاً للشراء — أُزيل من الطلب/)).toBeInTheDocument();
    expect(readCart()).toHaveLength(0);
  });

  it("selected variant gone (VARIANT_NOT_FOUND server-side): the line is dropped", async () => {
    seedCart();
    // Live payload no longer carries variant 101 (deactivated in catalog).
    getProductMock.mockResolvedValue(liveProduct({ variants: [] }));
    renderPage();

    await waitFor(() => expect(screen.getByText("سلتك فارغة")).toBeInTheDocument());
    expect(await screen.findByText(/أُزيل من الطلب/)).toBeInTheDocument();
    expect(readCart()).toHaveLength(0);
  });

  it("no change: silent — no notices, snapshot totals stand, CTA usable", async () => {
    seedCart();
    getProductMock.mockResolvedValue(liveProduct()); // byte-identical pricing
    renderPage();

    // The snapshot number stands in the line total, the subtotal AND
    // the grand total (each its own element — use the *AllBy* variant).
    const snapshotTotals = await screen.findAllByText("98.00 د.ل");
    expect(snapshotTotals.length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByText(PRICE_NOTICE)).not.toBeInTheDocument();
    expect(screen.queryByText(/أُزيل من الطلب/)).not.toBeInTheDocument();
    const cta = await screen.findByRole("button", { name: /إتمام الطلب/ });
    await waitFor(() => expect(cta).toBeEnabled());
    expect(cta.textContent).toContain("98.00 د.ل");
    // The stored snapshot was NOT rewritten (identity-stable no-op).
    expect(readCart()[0]).toEqual(CART_ITEM);
  });

  it("fetch failure: fail-open — the snapshot stands and the CTA still unlocks", async () => {
    seedCart();
    getProductMock.mockRejectedValue(new TypeError("failed to fetch"));
    renderPage();

    // Fail-open: the snapshot number still carries the summary (line
    // total + subtotal + grand total — each its own element).
    const snapshotTotals = await screen.findAllByText("98.00 د.ل");
    expect(snapshotTotals.length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByText(PRICE_NOTICE)).not.toBeInTheDocument();
    const cta = await screen.findByRole("button", { name: /إتمام الطلب/ });
    await waitFor(() => expect(cta).toBeEnabled());
  });

  it("the CTA stays disabled while the re-quote is in flight (never sells a stale total)", async () => {
    seedCart();
    let release!: (value: unknown) => void;
    getProductMock.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    renderPage();

    // While the re-quote is pending, the CTA's accessible label IS the
    // in-flight one («جارٍ تحديث الأسعار…») — query by THAT; the
    // confirm label «إتمام الطلب» cannot exist mid-flight.
    const cta = await screen.findByRole("button", { name: /جارٍ تحديث الأسعار/ });
    expect(cta).toBeDisabled();

    // The re-quote lands (unchanged pricing) → the CTA unlocks and
    // sells the final total.
    await act(async () => {
      release(liveProduct());
    });
    await waitFor(() => expect(cta).toBeEnabled());
    await waitFor(() => expect(cta.textContent).toContain("98.00 د.ل"));
  });
});
