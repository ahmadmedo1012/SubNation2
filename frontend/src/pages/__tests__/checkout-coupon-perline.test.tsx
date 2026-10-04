/**
 * 98-F2 (R98-A3 F1 / P1) — checkout coupon pre-flight vs the backend's
 * PER-UNIT coupon application.
 *
 * The pre-flight used to validate the coupon ONCE against the basket
 * total while the backend resolves it per unit against each unit's
 * basePrice (pricing.ts resolveCoupon + a coupon_code on every unit
 * order). These tests pin the per-line pre-flight + honest label math:
 *
 *   1. Scenario A — min_order_amount sits between a line's unit price
 *      (25) and the basket total (75): the apply-time check AND the
 *      confirm-time pre-flight reject the coupon with the LINE's precise
 *      Arabic reason, before a single charge (createOrder never fires).
 *   2. Scenario B — fixed 10, unit 25, qty 3: the label shows the
 *      per-unit-honest math the server charges — discount 30.00,
 *      total 45.00 (not the old basket-math lie of 10/65) — and a
 *      balance of 50 no longer trips the insufficient gate (45 ≤ 50);
 *      the per-unit loop semantics are unchanged (3 unit orders, each
 *      carrying coupon_code).
 *   3. Mixed basket — two lines at different unit prices: ONE validate
 *      request per DISTINCT unit price (25 + 60), the total is the Σ of
 *      per-line finals (15×2 + 50 = 80) and the displayed discount is
 *      basketBase − total (110 − 80 = 30).
 *
 * `@workspace/api-client-react` is mocked at the module boundary (the
 * vitest config's documented pattern); the cart rides the REAL
 * CartProvider seeded via localStorage; /api/auth/me and
 * /api/coupons/validate ride a URL-dispatching global fetch stub.
 */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CheckoutPage from "@/pages/checkout";
import { CartProvider } from "@/lib/cart";

const createOrderMock = vi.fn();
const getMeMock = vi.fn(async () => ({ wallet_balance: 1_000_000 }));
// R116-S2 (P3): the page's balance now rides the mocked useGetMe (the
// seeded /api/auth/me cache) — hoisted so the vi.mock factory below can
// read the per-test balance (Scenario B pins a 50 د.ل balance).
const balanceStub = vi.hoisted(() => ({ wallet: 1_000_000 }));
const getProductMock = vi.fn();

vi.mock("@workspace/api-client-react", () => ({
  createOrder: (...args: unknown[]) => createOrderMock(...(args as [])),
  getGetMeQueryKey: () => ["/api/auth/me"],
  getGetWalletQueryKey: () => ["/api/wallet"],
  getListOrdersQueryKey: () => ["/api/orders"],
  // R116-S2 (P3): the balance rides the seeded useGetMe cache now —
  // mirrors balanceStub so per-test balances keep their meaning
  // (Scenario B pins a 50 د.ل balance).
  useGetMe: vi.fn(() => ({
    data: { id: 7, wallet_balance: balanceStub.wallet },
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

/** Live-catalog mirror of the seeded cart — the mount-time re-quote
 *  (R98-A3 F5, tested in checkout-pricing-reconcile.test.tsx) must stay
 *  SILENT here so these tests isolate the coupon math. */
function liveProductFor(line: {
  productId: number;
  variantId: number;
  price: number;
  sale: number | null;
}) {
  return {
    id: line.productId,
    slug: null,
    name: "line",
    price: line.price,
    price_from: false,
    sale_price: line.sale,
    discount_percent: null,
    is_active: true,
    is_available: true,
    stock_count: 50,
    order_count: 0,
    variants: [
      {
        id: line.variantId,
        plan_label: null,
        duration_label: null,
        label: "option",
        price: line.price,
        sale_price: line.sale,
        discount_percent: null,
        is_available: true,
      },
    ],
  };
}

function seedCart(
  lines: Array<{
    productId: number;
    variantId: number;
    name: string;
    price: number;
    sale?: number | null;
    quantity: number;
  }>,
) {
  localStorage.setItem(
    "subnation_cart_v2",
    JSON.stringify(
      lines.map((l) => ({
        productId: l.productId,
        variantId: l.variantId,
        variantLabel: "option",
        slug: null,
        name: l.name,
        imageUrl: null,
        priceLYD: l.price,
        salePriceLYD: l.sale ?? null,
        discountPercent: null,
        quantity: l.quantity,
      })),
    ),
  );
  getProductMock.mockImplementation(async (id: number) => {
    const line = lines.find((l) => l.productId === id)!;
    return liveProductFor({
      productId: line.productId,
      variantId: line.variantId,
      price: line.price,
      sale: line.sale ?? null,
    });
  });
}

function readCart(): Array<{ productId: number; quantity: number }> {
  const raw = localStorage.getItem("subnation_cart_v2");
  return raw ? (JSON.parse(raw) as Array<{ productId: number; quantity: number }>) : [];
}

/** URL-dispatching fetch stub: /api/auth/me + /api/coupons/validate. */
const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  if (url === "/api/auth/me") {
    return { ok: true, json: async () => ({ wallet_balance: balanceStub.wallet }) };
  }
  if (url === "/api/coupons/validate") {
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      code: string;
      order_amount: number;
    };
    const handler = validateHandlers.get(body.code);
    return handler(body.order_amount);
  }
  return { ok: true, json: async () => ({}) };
});

/** Per-coupon validate behavior: (order_amount) → Response-like. */
const validateHandlers = new Map<
  string,
  (orderAmount: number) => { ok: boolean; json: () => unknown }
>();
// (balanceStub lives atop the file inside vi.hoisted — the vi.mock
// factory needs it before this module's body runs.)

function fixedCoupon(code: string, value: number) {
  validateHandlers.set(code, (orderAmount) => ({
    ok: true,
    json: async () => ({
      valid: true,
      code,
      type: "fixed",
      value,
      discount_amount: value,
      final_amount: +(orderAmount - value).toFixed(2),
      description: null,
    }),
  }));
}

function minOrderCoupon(code: string, minOrder: number) {
  validateHandlers.set(code, (orderAmount) => ({
    ok: false,
    json: async () => ({
      error: `هذا الكوبون يتطلب حد أدنى للطلب ${minOrder.toFixed(2)} د.ل`,
      code: "INVALID_DATA",
    }),
  }));
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

async function clickConfirm() {
  const btn = await screen.findByRole("button", { name: /إتمام الطلب/ });
  await waitFor(() => expect(btn).toBeEnabled());
  fireEvent.click(btn);
}

async function applyCoupon(code: string) {
  fireEvent.change(await screen.findByPlaceholderText("أدخل رمز الكوبون"), {
    target: { value: code },
  });
  fireEvent.click(await screen.findByRole("button", { name: "تحقق" }));
}

beforeEach(() => {
  createOrderMock.mockReset();
  getMeMock.mockClear();
  getProductMock.mockReset();
  toastSpy.mockReset();
  validateHandlers.clear();
  balanceStub.wallet = 1_000_000;
  fetchMock.mockClear();
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CheckoutPage — per-line coupon pre-flight (98-F2 / R98-A3 F1 P1)", () => {
  it("Scenario A: min_order between the unit price and the basket total is rejected with the LINE's reason — apply AND confirm paths", async () => {
    // unit 25 × qty 3 → basket 75; coupon min_order 30 sits between them:
    // the OLD basket-level pre-flight passed (75 ≥ 30) and every unit
    // order then 400'd below_min_order after the UI green-lit it.
    seedCart([{ productId: 5, variantId: 101, name: "Netflix شهر", price: 25, quantity: 3 }]);
    minOrderCoupon("MIN30", 30);
    renderPage();

    await applyCoupon("MIN30");

    // The apply-time notice carries the backend's precise Arabic reason.
    const notice = await screen.findByText(/هذا الكوبون يتطلب حد أدنى للطلب 30\.00 د\.ل/);
    expect(notice).toHaveAttribute("role", "alert");
    // The validate request priced the LINE's unit (25), not the basket.
    const callBody = JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body ?? "{}")) as {
      order_amount: number;
    };
    expect(callBody.order_amount).toBe(25);
    // No coupon applied → the CTA sells the plain total.
    const cta = await screen.findByRole("button", { name: /إتمام الطلب/ });
    expect(cta.textContent).toContain("75.00 د.ل");

    // Confirm-time pre-flight (the code is still in the field): rejected
    // BEFORE any charge.
    await clickConfirm();
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: "تعذّر تطبيق الكوبون" }),
      ),
    );
    const banner = await screen.findByText(/تعذّر إتمام الطلب/);
    expect(banner.textContent).toContain("حد أدنى");
    expect(banner.textContent).toContain("لم يتم خصم أي مبلغ");
    expect(createOrderMock).not.toHaveBeenCalled();
    expect(readCart()).toHaveLength(1);
  });

  it("Scenario B: fixed 10 × qty 3 @ 25 — label shows discount 30.00 / total 45.00 and a 50 د.ل balance is sufficient", async () => {
    seedCart([{ productId: 5, variantId: 101, name: "Netflix شهر", price: 25, quantity: 3 }]);
    fixedCoupon("FIXED10", 10);
    // The real cost is 45 — a balance of 50 must NOT trip the gate (the
    // old basket-math total of 65 blocked exactly this user).
    balanceStub.wallet = 50;
    renderPage();

    await applyCoupon("FIXED10");

    // Honest per-unit math: each line row shows the POST-coupon unit final.
    await waitFor(() => expect(screen.getByText(/3 × 15\.00 د\.ل/)).toBeInTheDocument());
    // "45.00 د.ل" appears exactly twice: the line total + the summary
    // total (both the per-unit-honest number the loop charges).
    expect(screen.getAllByText("45.00 د.ل")).toHaveLength(2);
    // Summary: subtotal 75 − discount 30 = total 45 (the discount row is
    // the only exact "−30.00 د.ل" match; the chip text runs longer).
    expect(screen.getByText("−30.00 د.ل")).toBeInTheDocument();
    expect(screen.getByText("المجموع الفرعي")).toBeInTheDocument();
    expect(screen.getByText("75.00 د.ل")).toBeInTheDocument(); // subtotal (pre-coupon base)
    expect(screen.getByText("الإجمالي بعد الكوبون")).toBeInTheDocument();
    // Insufficient-balance banner must be absent (50 ≥ 45).
    await waitFor(() =>
      expect(screen.queryByText(/رصيد المحفظة غير كافٍ/)).not.toBeInTheDocument(),
    );
    // CTA carries the honest number.
    const cta = await screen.findByRole("button", { name: /إتمام الطلب/ });
    expect(cta.textContent).toContain("45.00 د.ل");

    // The per-unit loop semantics are untouched: 3 unit orders, each
    // carrying the coupon code (the server stays the pricing authority).
    createOrderMock.mockImplementation(async () => ({ order_code: "SNPERLINE1" }));
    await clickConfirm();
    await waitFor(() => expect(createOrderMock).toHaveBeenCalledTimes(3));
    for (const call of createOrderMock.mock.calls) {
      expect(call[0]).toEqual(
        expect.objectContaining({ product_id: 5, variant_id: 101, coupon_code: "FIXED10" }),
      );
    }
    // Full success → cart synced to empty.
    await waitFor(() => expect(readCart()).toHaveLength(0));
  });

  it("mixed basket: ONE validate per DISTINCT unit price; total = Σ per-line finals; discount = basketBase − total", async () => {
    seedCart([
      { productId: 5, variantId: 101, name: "Netflix شهر", price: 25, quantity: 2 },
      { productId: 6, variantId: 200, name: "Spotify شهر", price: 60, quantity: 1 },
    ]);
    fixedCoupon("FIXED10", 10);
    renderPage();

    await applyCoupon("FIXED10");

    await waitFor(() => expect(screen.getByText("الإجمالي بعد الكوبون")).toBeInTheDocument());

    // Distinct prices only: 25 and 60 → exactly two validate calls.
    const validateCalls = fetchMock.mock.calls.filter(([u]) => u === "/api/coupons/validate");
    expect(validateCalls).toHaveLength(2);
    const amounts = validateCalls.map(
      ([, init]) =>
        (JSON.parse(String(init?.body ?? "{}")) as { order_amount: number }).order_amount,
    );
    expect(amounts).toEqual(expect.arrayContaining([25, 60]));

    // 15×2 + 50 = 80; subtotal 110 − discount 30 = 80.
    expect(screen.getByText("−30.00 د.ل")).toBeInTheDocument();
    const totalRow = screen.getByText("الإجمالي بعد الكوبون").closest("div")!;
    expect(within(totalRow).getByText("80.00 د.ل")).toBeInTheDocument();
    expect(screen.getByText("110.00 د.ل")).toBeInTheDocument(); // subtotal
    const cta = await screen.findByRole("button", { name: /إتمام الطلب/ });
    expect(cta.textContent).toContain("80.00 د.ل");
  });

  it("mixed basket names the failing line when one line rejects (below min-order)", async () => {
    seedCart([
      { productId: 5, variantId: 101, name: "Netflix شهر", price: 25, quantity: 2 },
      { productId: 6, variantId: 200, name: "Spotify شهر", price: 60, quantity: 1 },
    ]);
    minOrderCoupon("MIN30", 30);
    renderPage();

    await applyCoupon("MIN30");

    const notice = await screen.findByText(/هذا الكوبون يتطلب حد أدنى للطلب 30\.00 د\.ل/);
    expect(notice.textContent).toContain("Netflix شهر");
  });
});
