/**
 * R115-I1 (A7 P2-1 + P2-2) — product-page price honesty.
 *
 * P2-1 (variant-aware strikethrough): the old-price strike used
 * product.price — the MIN variant price (backend contract) — while the
 * displayed price is the SELECTED variant's. On a multi-variant product
 * with a flash sale the price block read «was 25 → now 80» for any
 * non-cheapest option. The strike must mirror the duration pills: the
 * SELECTED option's base price.
 *
 * P2-2 (pre-buy re-quote): handleBuyIntent sends no price and never
 * re-quoted — a page open across a flash-sale boundary charged the LIVE
 * price under a STALE label (checkout got the 98-F2 mount re-quote; the
 * single-buy path never did). The buy now re-quotes getProduct(product.id)
 * right before the charge:
 *   • live effective price ≠ displayed (or the selected option vanished)
 *     → ABORT (no createOrder, no intent key minted), product data
 *     refetched, coupon voided, honest toast «تحديث السعر»;
 *   • re-quote fetch failure → FAIL-OPEN: proceed with the displayed
 *     price (the server re-prices the order anyway — 98-F2 contract).
 *
 * `@workspace/api-client-react` is mocked at the module boundary (the
 * vitest config's documented pattern for page-level component tests).
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Route, Router } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProductPage from "@/pages/product";

const createOrderMock = vi.fn();
const getMeMock = vi.fn(async () => ({ id: 7, wallet_balance: 51 }));
const getProductMock = vi.fn();
const refetchMock = vi.fn();

/** Simple variant-less product (price 49, no sale). */
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

/** Multi-variant product modeled on the backend contract: product.price /
 *  product.sale_price carry the CHEAPEST option's pricing (MIN price),
 *  while each variant carries its own. */
const VARIANT_PRODUCT = {
  ...SIMPLE_PRODUCT,
  id: 11,
  name: "Spotify بريميوم",
  category: "music",
  price: 25, // MIN(variants.price)
  price_from: true,
  sale_price: 20, // the cheapest option's flash sale rides the product level
  discount_percent: 20,
  variants: [
    {
      id: 1,
      plan_label: null,
      duration_label: "شهر واحد",
      label: "شهر واحد",
      price: 25,
      sale_price: 20,
      discount_percent: 20,
      is_available: true,
    },
    {
      id: 2,
      plan_label: null,
      duration_label: "3 أشهر",
      label: "3 أشهر",
      price: 100,
      sale_price: 80,
      discount_percent: 20,
      is_available: true,
    },
  ],
};

// Which product the PAGE's own query serves — per-test mutable.
const pageProduct = { current: SIMPLE_PRODUCT };

vi.mock("@workspace/api-client-react", () => ({
  createOrder: (...args: unknown[]) => createOrderMock(...(args as [])),
  getProduct: (...args: unknown[]) => getProductMock(...(args as [])),
  getMe: () => getMeMock(),
  getGetMeQueryKey: () => ["/api/auth/me"],
  getGetWalletQueryKey: () => ["/api/wallet"],
  getListOrdersQueryKey: () => ["/api/orders"],
  getGetProductQueryKey: (id: number) => [`/api/products/${id}`],
  getGetProductRecommendationsQueryKey: (id: number) => [`/api/products/${id}/recommendations`],
  useGetMe: () => ({ data: { id: 7, wallet_balance: 1_000_000 }, isLoading: false }),
  useGetProduct: () => ({
    data: pageProduct.current,
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

const toastSpy = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastSpy }),
}));

let queryClient: QueryClient;

function renderPage() {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  window.history.pushState({}, "", `/product/${pageProduct.current.id}`);
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

async function selectVariant(label: RegExp) {
  const pill = screen.getByRole("radio", { name: label });
  await act(async () => {
    fireEvent.click(pill);
  });
}

/** The price+stock box: the stock status div's PARENT. Scopes the
 *  strikethrough query away from the duration pills (which render their
 *  own per-variant strikes). */
function priceBox(): HTMLElement {
  const stock = screen.getByRole("status", { name: /المنتج متوفر/ });
  return stock.parentElement as HTMLElement;
}

beforeEach(() => {
  createOrderMock.mockReset();
  getProductMock.mockReset();
  getMeMock.mockClear();
  refetchMock.mockReset();
  toastSpy.mockReset();
  localStorage.clear();
  pageProduct.current = SIMPLE_PRODUCT;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ProductPage — variant-aware strikethrough (R115-I1 / A7 P2-1)", () => {
  it("default (cheapest) selection: current price = the option's sale, strike = ITS base price", () => {
    pageProduct.current = VARIANT_PRODUCT;
    renderPage();

    const box = priceBox();
    // Current: v1 sale 20 (product-level numbers coincide here).
    expect(box.querySelector(".text-3xl")?.textContent).toBe("20.00 د.ل");
    const strike = box.querySelector(".line-through");
    expect(strike).not.toBeNull();
    expect(strike!.textContent).toBe("25.00 د.ل");
  });

  it("selecting a pricier option: the strike follows THE OPTION's base price — not product.price (the MIN)", async () => {
    pageProduct.current = VARIANT_PRODUCT;
    renderPage();

    // Switch to «3 أشهر» (base 100, sale 80).
    await selectVariant(/3 أشهر/);

    const box = priceBox();
    expect(box.querySelector(".text-3xl")?.textContent).toBe("80.00 د.ل");
    const strike = box.querySelector(".line-through");
    expect(strike).not.toBeNull();
    // THE FIX: 100 (v2's base), never 25 (product.price = MIN variant).
    expect(strike!.textContent).toBe("100.00 د.ل");
    expect(strike!.textContent).not.toBe("25.00 د.ل");
  });

  it("variant-less products keep the product-level strike (base price)", () => {
    pageProduct.current = { ...SIMPLE_PRODUCT, price: 50, sale_price: 40 };
    renderPage();

    const box = priceBox();
    expect(box.querySelector(".text-3xl")?.textContent).toBe("40.00 د.ل");
    expect(box.querySelector(".line-through")?.textContent).toBe("50.00 د.ل");
  });

  it("no strike when the effective selection carries no sale price", () => {
    pageProduct.current = {
      ...VARIANT_PRODUCT,
      sale_price: null,
      variants: VARIANT_PRODUCT.variants.map((v) => ({ ...v, sale_price: null })),
    };
    renderPage();

    expect(priceBox().querySelector(".line-through")).toBeNull();
  });
});

describe("ProductPage — pre-buy live re-quote (R115-I1 / A7 P2-2)", () => {
  it("ABORTS the buy when the live price differs: no order, no key minted, honest toast + refetch", async () => {
    renderPage();

    // The flash sale ended server-side: live 60 vs the displayed 49.
    getProductMock.mockResolvedValueOnce({ ...SIMPLE_PRODUCT, price: 60, sale_price: null });

    await clickBuy();

    // The charge never happened and no retry token was persisted (the
    // abort lands BEFORE the fingerprint/key minting).
    expect(createOrderMock).not.toHaveBeenCalled();
    expect(getProductMock).toHaveBeenCalledWith(SIMPLE_PRODUCT.id);
    expect(localStorage.getItem(`subnation_buykey:${SIMPLE_PRODUCT.id}`)).toBeNull();

    // Honest toast (exact copy family from the fix contract).
    expect(toastSpy).toHaveBeenCalledTimes(1);
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "تحديث السعر",
        description: expect.stringContaining("تغيّر السعر منذ فتحت الصفحة"),
      }),
    );
    // The page's product data is refreshed so the shopper sees the live
    // number immediately.
    expect(refetchMock).toHaveBeenCalled();

    // The CTA is re-armed (buyPending cleared by the finally block).
    const btn = await screen.findByRole("button", { name: /اشترِ الآن/ });
    await waitFor(() => expect(btn).toBeEnabled());
  });

  it("aborts when the SELECTED VARIANT's live price changed (multi-variant flash sale end)", async () => {
    pageProduct.current = VARIANT_PRODUCT;
    renderPage();

    await selectVariant(/3 أشهر/); // displayed: sale 80, base 100

    // Live catalog: the 3-month option reverted to its base price.
    getProductMock.mockResolvedValueOnce({
      ...VARIANT_PRODUCT,
      variants: VARIANT_PRODUCT.variants.map((v) => (v.id === 2 ? { ...v, sale_price: null } : v)),
    });

    await clickBuy();

    expect(createOrderMock).not.toHaveBeenCalled();
    expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "تحديث السعر" }));
    expect(refetchMock).toHaveBeenCalled();
  });

  it("aborts when the selected option no longer exists in the live catalog", async () => {
    pageProduct.current = VARIANT_PRODUCT;
    renderPage();

    await selectVariant(/3 أشهر/);

    // Live catalog deactivated the 3-month option entirely.
    getProductMock.mockResolvedValueOnce({
      ...VARIANT_PRODUCT,
      variants: [VARIANT_PRODUCT.variants[0]],
    });

    await clickBuy();

    expect(createOrderMock).not.toHaveBeenCalled();
    expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "تحديث السعر" }));
  });

  it("FAILS OPEN on a re-quote fetch error: the buy proceeds with the displayed price", async () => {
    renderPage();

    getProductMock.mockRejectedValueOnce(new TypeError("failed to fetch"));
    createOrderMock.mockResolvedValueOnce({
      order_code: "SNDBUY010",
      amount: 49,
      delivered_email: null,
      delivered_password: null,
    });

    await clickBuy();

    // Fail-open contract (98-F2 mirror): the displayed price stands; the
    // server re-prices the order on its side regardless.
    await waitFor(() => expect(createOrderMock).toHaveBeenCalledTimes(1));
    expect(createOrderMock.mock.calls[0][0]).toEqual({ product_id: SIMPLE_PRODUCT.id });
    expect(toastSpy).not.toHaveBeenCalledWith(expect.objectContaining({ title: "تحديث السعر" }));
    // The success screen is up with its money receipt (charged amount).
    expect(await screen.findByText("تم الشراء بنجاح!")).toBeInTheDocument();
    expect(screen.getByText("المبلغ المخصوم")).toBeInTheDocument();
    expect(screen.getByText("49.00 د.ل")).toBeInTheDocument();
  });

  it("an unchanged live price does not disturb the buy (happy path unbroken)", async () => {
    renderPage();

    getProductMock.mockResolvedValueOnce(SIMPLE_PRODUCT);
    createOrderMock.mockResolvedValueOnce({ order_code: "SNDBUY011", amount: 49 });

    await clickBuy();

    await waitFor(() => expect(createOrderMock).toHaveBeenCalledTimes(1));
    expect(toastSpy).not.toHaveBeenCalled();
    expect(await screen.findByText("تم الشراء بنجاح!")).toBeInTheDocument();
  });

  it("the success receipt completes with the post-charge balance once the /me refresh lands", async () => {
    renderPage();

    getProductMock.mockResolvedValueOnce(SIMPLE_PRODUCT);
    createOrderMock.mockResolvedValueOnce({ order_code: "SNDBUY012", amount: 49 });

    await clickBuy();
    await waitFor(() => expect(createOrderMock).toHaveBeenCalledTimes(1));

    // The no-store /me refresh seeds the receipt's «رصيدك المتبقي» row —
    // never a stale pre-purchase balance (the row is absent until it).
    expect(await screen.findByText("رصيدك المتبقي")).toBeInTheDocument();
    // getMeMock resolves wallet_balance 51 (the post-charge figure).
    expect(screen.getAllByText("51.00 د.ل").length).toBeGreaterThan(0);
    expect(getMeMock).toHaveBeenCalled();
  });
});
