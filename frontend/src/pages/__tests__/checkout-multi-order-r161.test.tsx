/**
 * R161-G (Lane G — R160 carry-over): the checkout terminal-branch honesty
 * pair + the two P4s the round's audit landed on the same page.
 *
 *   1. MONEY HONESTY (audit E#1, P2): a COMPLETE failure that rode units
 *      another tab already charged/removed (skippedByOtherTab > 0) must NOT
 *      render the banner's «لم يتم خصم أي مبلغ» subline — from this tab
 *      the wallet state is unknown, and the wallet view can contradict
 *      the claim on arrival (the same fabrication class R160-F1 closed for
 *      the network-partial path). A plain complete failure keeps it.
 *   2. P4 — the coupon field's Enter path now carries the couponChecking
 *      re-entry guard the disabled apply button always had (CouponCard).
 *   3. P4 — the network catch mirrors the try-side partial path's catalog
 *      invalidations (product-by-slug + /api/products): a network-partial
 *      consumed real stock; the PDP/catalog caches must not serve the
 *      pre-purchase stock for up to their 3-min staleTime.
 *
 * Same harness shape as checkout-idempotency-keys.test.tsx (the module
 * boundary mock + the real CartProvider seeded via localStorage); the
 * full-success landing tests themselves live in that suite, beside the
 * lifecycle pins they complete.
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CheckoutPage from "@/pages/checkout";
import { CartProvider } from "@/lib/cart";

const createOrderMock = vi.fn();
const getMeMock = vi.fn(async () => ({ wallet_balance: 1_000_000 }));
const getProductMock = vi.fn();
const validateCouponMock = vi.fn();

vi.mock("@workspace/api-client-react", () => ({
  createOrder: (...args: unknown[]) => createOrderMock(...args),
  getGetMeQueryKey: () => ["/api/auth/me"],
  getGetWalletQueryKey: () => ["/api/wallet"],
  getListOrdersQueryKey: () => ["/api/orders"],
  useGetMe: vi.fn(() => ({
    data: { id: 7, wallet_balance: 1_000_000 },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  })),
  getMe: (...args: unknown[]) => getMeMock(...(args as [])),
  // useCheckoutRequote's mount re-quote: rejected + non-ApiError = the
  // fail-open arm (snapshot stands, CTA unlocks — the suite never asserts
  // requote behavior).
  getProduct: (...args: unknown[]) => getProductMock(...(args as [])),
  // coupon-quote's per-line pre-flight (the Enter-guard test controls it).
  validateCoupon: (...args: unknown[]) => validateCouponMock(...(args as [])),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

const toastSpy = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastSpy }),
}));

/** ApiError-shaped rejection — the page reads the envelope from `.data`. */
function httpApiError(error: string) {
  return Object.assign(new Error(error), {
    name: "ApiError",
    status: 409,
    data: { error, code: "NO_STOCK" },
  });
}

function seedLines(
  lines: Array<{
    productId: number;
    variantId: number;
    name: string;
    price: number;
    quantity?: number;
  }>,
) {
  localStorage.setItem(
    "subnation_cart_v2",
    JSON.stringify(
      lines.map((l) => ({
        productId: l.productId,
        variantId: l.variantId,
        variantLabel: "شهر واحد",
        slug: `p-${l.productId}`,
        name: l.name,
        imageUrl: null,
        priceLYD: l.price,
        salePriceLYD: l.price,
        discountPercent: null,
        quantity: l.quantity ?? 1,
      })),
    ),
  );
}

function readCart(): Array<{ productId: number; quantity: number }> {
  const raw = localStorage.getItem("subnation_cart_v2");
  return raw ? (JSON.parse(raw) as Array<{ productId: number; quantity: number }>) : [];
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <Router>
        <CartProvider>
          <CheckoutPage />
        </CartProvider>
      </Router>
    </QueryClientProvider>,
  );
  return { client, ...view };
}

async function clickConfirm() {
  const btn = await screen.findByRole("button", { name: /إتمام الطلب/ });
  await waitFor(() => expect(btn).toBeEnabled());
  fireEvent.click(btn);
}

describe("CheckoutPage — R161-G terminal-branch honesty + the P4 pair", () => {
  beforeEach(() => {
    createOrderMock.mockReset();
    getMeMock.mockClear();
    getProductMock.mockReset();
    getProductMock.mockRejectedValue(new Error("requote off in this suite"));
    validateCouponMock.mockReset();
    toastSpy.mockReset();
    localStorage.clear();
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

  it("audit E#1: a unit skipped-by-other-tab AND another unit failing renders NO «لم يتم خصم أي مبلغ» claim (the wallet state is unknown from this tab)", async () => {
    // Line A (product 5) is completed by ANOTHER tab mid-flight — its
    // cart-sync removed the line before this loop's stale snapshot
    // reached it (the per-unit live re-read sees the line gone → skip).
    // Line B (product 6) then fails definitively: the banner must carry
    // the bare error, never the fabricated no-deduction claim — the
    // other tab's charges are invisible here and the wallet view can
    // contradict the claim on arrival.
    seedLines([
      { productId: 5, variantId: 101, name: "Netflix شهر", price: 49 },
      { productId: 6, variantId: 202, name: "Spotify شهر", price: 25 },
    ]);
    renderPage();

    // The other tab's cart-sync lands BEFORE this confirm starts.
    const live = readCart();
    localStorage.setItem(
      "subnation_cart_v2",
      JSON.stringify(live.filter((l) => l.productId !== 5)),
    );

    createOrderMock.mockRejectedValueOnce(httpApiError("نفد المخزون"));
    await clickConfirm();
    await waitFor(() => expect(createOrderMock).toHaveBeenCalledTimes(1));

    // The failure banner owns the page (role=alert, persistent)…
    const banner = await screen.findByRole("alert");
    expect(banner.textContent).toContain("تعذّر إتمام الطلب");
    expect(banner.textContent).toContain("نفد المخزون");
    // …and the no-deduction claim is GONE (skips happened — unknown
    // wallet state from this tab).
    expect(banner.textContent).not.toContain("لم يتم خصم أي مبلغ");
  });

  it("audit E#1 (the control): a PLAIN complete failure keeps the refund claim", async () => {
    // No skips — this tab charged nothing and knows it; the claim is
    // honest and must stay (also pinned at coupon-preflight level in
    // checkout-coupon-perline:342 — this is the unit-order failure arm).
    seedLines([{ productId: 5, variantId: 101, name: "Netflix شهر", price: 49 }]);
    renderPage();

    createOrderMock.mockRejectedValueOnce(httpApiError("نفد المخزون"));
    await clickConfirm();
    await waitFor(() => expect(createOrderMock).toHaveBeenCalledTimes(1));

    const banner = await screen.findByRole("alert");
    expect(banner.textContent).toContain("تعذّر إتمام الطلب: نفد المخزون");
    expect(banner.textContent).toContain("لم يتم خصم أي مبلغ");
  });

  it("P4: Enter on the coupon field is guarded while a validate is in flight (keyboard matches the disabled button)", async () => {
    seedLines([{ productId: 5, variantId: 101, name: "Netflix شهر", price: 49 }]);
    renderPage();

    const input = await screen.findByPlaceholderText("أدخل رمز الكوبون");
    fireEvent.change(input, { target: { value: "SAVE10" } });

    // First Enter fires the apply — the validate hangs so couponChecking
    // stays armed (the exact window the apply button disables for).
    let releaseValidate: (value: unknown) => void = () => {};
    validateCouponMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseValidate = resolve;
        }),
    );
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(validateCouponMock).toHaveBeenCalledTimes(1));
    // The checking state is live on the card (the button's sr-only twin).
    expect(await screen.findByText("جارٍ التحقق…")).toBeInTheDocument();

    // Rapid re-Enter during the flight: the button path is disabled —
    // the keyboard path must not bypass that re-entry guard.
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(validateCouponMock).toHaveBeenCalledTimes(1);

    // Release: the FIRST apply still completes normally (the guard never
    // swallowed the initial Enter).
    await act(async () => {
      releaseValidate({ valid: true, final_amount: 39 });
    });
    // 49 − 39 = 10: the applied-coupon status line (role=status) renders.
    const applied = await screen.findByText(/خصم 10\.00 د\.ل/);
    expect(applied).toHaveAttribute("role", "status");
  });

  it("P4: the network catch mirrors the try-side catalog invalidations (a network-partial consumed real stock)", async () => {
    seedLines([{ productId: 5, variantId: 101, name: "Netflix شهر", price: 49, quantity: 2 }]);
    const { client } = renderPage();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");

    // Unit 1 confirms (stock consumed, wallet moved); unit 2 drops at
    // the network level → the outer catch — the try-side invalidation
    // block never runs.
    createOrderMock
      .mockResolvedValueOnce({ order_code: "SNDNETPARTIAL" })
      .mockRejectedValueOnce(new TypeError("failed to fetch"));
    await clickConfirm();
    await waitFor(() => expect(createOrderMock).toHaveBeenCalledTimes(2));

    // The partial banner owns the verdict…
    expect(await screen.findByText(/بنجاح قبل توقف العملية/)).toBeInTheDocument();
    // …and the catch refreshed the PDP/catalog caches too, not just the
    // money ones (the pre-fix gap: stale stock_count/is_available for up
    // to the 3-min staleTime).
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ["product-by-slug"] }),
      ),
    );
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["/api/products"] }),
    );
  });
});
