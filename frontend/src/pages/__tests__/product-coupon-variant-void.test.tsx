/**
 * R98-01 (r98 frontend-deep §2 — P1) — product-page coupon × variant desync.
 *
 * The validated coupon result was never voided when the selected variant
 * changed: validateCoupon() computes its math against the SELECTED
 * variant's base price, but every render path kept pushing the OLD
 * final_amount — a shopper who validated a fixed 10 د.ل coupon on a 50 د.ل
 * option (chip: 40.00), then switched to a 100 د.ل option, confirmed a
 * purchase labeled «اشترِ الآن — 40.00 د.ل» while the server re-computed
 * the coupon against the NEW price and charged 90.00.
 *
 * These tests pin the checkout.tsx-style void (checkout.tsx:243-249 does
 * the same for cart-line changes) plus the async hole the plain effect
 * alone would leave open (a validate response landing AFTER a switch):
 *
 *   1. validate on variant A → chip + CTA show A's post-coupon price;
 *   2. switch to variant B → couponResult voided: CTA shows B's PLAIN
 *      price, the coupon chip is gone, the input keeps the typed code
 *      (re-validating is one tap) and is re-enabled;
 *   3. switch back to variant A → still clean (plain price, no chip);
 *   4. re-validating on the now-selected variant works again.
 *
 * `@workspace/api-client-react` is mocked at the module boundary (the
 * vitest config's documented pattern for page-level component tests);
 * /api/coupons/validate rides a stubbed global fetch.
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Route, Router } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProductPage from "@/pages/product";

const createOrderMock = vi.fn();
const getMeMock = vi.fn(async () => ({ id: 7, wallet_balance: 1_000_000 }));

/** Multi-variant product — the defect only reproduces when switching is possible. */
const PRODUCT = {
  id: 5,
  slug: null,
  name: "Spotify بريميوم",
  description: "اشتراك شهري",
  category: "music",
  price: 50,
  price_from: true,
  sale_price: null,
  image_url: null,
  is_active: true,
  is_available: true,
  stock_count: 12,
  discount_percent: null,
  usage_terms: null,
  order_count: 0,
  variants: [
    {
      id: 1,
      plan_label: null,
      duration_label: "شهر واحد",
      label: "شهر واحد",
      price: 50,
      sale_price: null,
      discount_percent: null,
      is_available: true,
    },
    {
      id: 2,
      plan_label: null,
      duration_label: "3 أشهر",
      label: "3 أشهر",
      price: 100,
      sale_price: null,
      discount_percent: null,
      is_available: true,
    },
  ],
};

vi.mock("@workspace/api-client-react", () => ({
  createOrder: (...args: unknown[]) => createOrderMock(...(args as [])),
  getMe: () => getMeMock(),
  getGetMeQueryKey: () => ["/api/auth/me"],
  getGetWalletQueryKey: () => ["/api/wallet"],
  getListOrdersQueryKey: () => ["/api/orders"],
  getGetProductQueryKey: (id: number) => [`/api/products/${id}`],
  getGetProductRecommendationsQueryKey: (id: number) => [`/api/products/${id}/recommendations`],
  useGetMe: () => ({ data: { id: 7, wallet_balance: 1_000_000 }, isLoading: false }),
  useGetProduct: () => ({ data: PRODUCT, isLoading: false }),
  useGetProductRecommendations: () => ({ data: [], isLoading: false }),
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

/** The validate stub: fixed 10 د.ل off whatever unit price is asked about. */
const validateFetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
  const body = JSON.parse(String(init?.body ?? "{}")) as {
    code: string;
    order_amount: number;
  };
  const discount = 10;
  return {
    ok: true,
    json: async () => ({
      valid: true,
      code: body.code,
      type: "fixed",
      value: discount,
      discount_amount: discount,
      final_amount: +(body.order_amount - discount).toFixed(2),
      description: null,
    }),
  };
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  window.history.pushState({}, "", `/product/${PRODUCT.id}`);
  return render(
    <QueryClientProvider client={client}>
      <Router>
        <Route path="/product/:slug" component={ProductPage} />
      </Router>
    </QueryClientProvider>,
  );
}

/** The coupon field renders twice (mobile section + desktop CTA block) —
 *  drive the DESKTOP instance (last in DOM order); both are bound to the
 *  same state, so the assertions hold for either. */
const desktopCouponInput = () => screen.getAllByPlaceholderText("رمز الكوبون").at(-1)!;
const desktopValidateButton = () => screen.getAllByRole("button", { name: "تحقق" }).at(-1)!;

const switchVariant = async (label: RegExp) => {
  const pill = screen.getByRole("radio", { name: label });
  await act(async () => {
    fireEvent.click(pill);
  });
};

async function buyCtaLabel(): Promise<string> {
  const btn = await screen.findByRole("button", { name: /اشترِ الآن/ });
  return btn.textContent ?? "";
}

beforeEach(() => {
  createOrderMock.mockReset();
  getMeMock.mockClear();
  toastSpy.mockReset();
  vi.stubGlobal("fetch", validateFetchMock);
  validateFetchMock.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ProductPage — coupon × variant desync (R98-01 / P1)", () => {
  it("voids the validated coupon when the variant switches and shows the new variant's PLAIN price", async () => {
    renderPage();

    // Default selection = cheapest (شهر واحد, 50).
    expect(await buyCtaLabel()).toContain("50.00 د.ل");

    // Validate SAVE10 on variant A → chip + CTA show 40.00.
    fireEvent.change(desktopCouponInput(), { target: { value: "save10" } });
    await act(async () => {
      fireEvent.click(desktopValidateButton());
    });
    expect(await buyCtaLabel()).toContain("40.00 د.ل");
    expect(screen.getAllByText(/−10\.00 د\.ل/).length).toBeGreaterThan(0);

    // The stub was called with variant A's base price (50).
    const firstCallBody = JSON.parse(
      String(validateFetchMock.mock.calls[0][1]?.body ?? "{}"),
    ) as { order_amount: number };
    expect(firstCallBody.order_amount).toBe(50);

    // Switch to 3 أشهر (100) — the coupon MUST void.
    await switchVariant(/3 أشهر/);
    expect(await buyCtaLabel()).toContain("100.00 د.ل");
    // The success chip is gone (both instances).
    expect(screen.queryByText(/−10\.00 د\.ل/)).not.toBeInTheDocument();
    // The typed code is kept (re-validating is one tap) and the input is
    // re-enabled (it is disabled while a coupon is applied).
    const input = desktopCouponInput() as HTMLInputElement;
    expect(input.value).toBe("SAVE10");
    expect(input).toBeEnabled();

    // Switch back to شهر واحد — still clean, no stale resurrection.
    await switchVariant(/شهر واحد/);
    expect(await buyCtaLabel()).toContain("50.00 د.ل");
    expect(screen.queryByText(/−10\.00 د\.ل/)).not.toBeInTheDocument();
  });

  it("re-validating after a switch prices the coupon against the NEW variant", async () => {
    renderPage();

    fireEvent.change(desktopCouponInput(), { target: { value: "SAVE10" } });
    await act(async () => {
      fireEvent.click(desktopValidateButton());
    });
    expect(await buyCtaLabel()).toContain("40.00 د.ل");

    await switchVariant(/3 أشهر/);
    expect(await buyCtaLabel()).toContain("100.00 د.ل");

    // One tap re-validate on the new variant → 100 − 10 = 90.
    await act(async () => {
      fireEvent.click(desktopValidateButton());
    });
    expect(await buyCtaLabel()).toContain("90.00 د.ل");
    const secondCallBody = JSON.parse(
      String(validateFetchMock.mock.calls.at(-1)?.[1]?.body ?? "{}"),
    ) as { order_amount: number };
    expect(secondCallBody.order_amount).toBe(100);
  });

  it("discards a validate response that lands AFTER a variant switch (async hole)", async () => {
    renderPage();

    fireEvent.change(desktopCouponInput(), { target: { value: "SAVE10" } });

    // A validate request that resolves LATE (slow 3G) — after the switch.
    let release!: (value: Response) => void;
    const deferred = new Promise<Response>((resolve) => {
      release = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return deferred;
      }) as unknown as typeof fetch,
    );
    await act(async () => {
      fireEvent.click(desktopValidateButton());
    });

    // The user switches variant while the request is in flight.
    await switchVariant(/3 أشهر/);

    await act(async () => {
      release({
        ok: true,
        json: async () => ({
          valid: true,
          code: "SAVE10",
          type: "fixed",
          value: 10,
          discount_amount: 10,
          final_amount: 40, // variant A's math — stale for the new variant
          description: null,
        }),
      } as Response);
    });

    // The late response must NOT resurrect variant A's price label.
    await waitFor(() => expect(desktopValidateButton()).toBeEnabled());
    expect(await buyCtaLabel()).toContain("100.00 د.ل");
    expect(screen.queryByText(/−10\.00 د\.ل/)).not.toBeInTheDocument();
  });
});
