/**
 * 96-F4 (R96 A4 §2.2 — money P1): stable per-unit Idempotency-Key storage
 * on the checkout confirm loop.
 *
 * The unit loop used to mint a fresh key on every confirm click, so a
 * manual retry after a NETWORK-level failure (the outer catch
 * deliberately keeps the cart — server state unknown) sent NEW keys for
 * units whose request may already have committed → double charge on
 * flaky mobile links. The backend Redis/in-tx guard can only dedupe
 * when it sees the SAME key twice.
 *
 * These tests pin the full lifecycle:
 *   1. NETWORK failure → the stored key SURVIVES and the retry REUSES it
 *      (the double-charge fix — same header on the second createOrder).
 *   2. Success (cart synced) → the accounted unit's key is DELETED.
 *   3. Definitive HTTP rejection (ApiError) → the unit's key is DELETED
 *      so a retry isn't answered forever by the cached error.
 *   4. Partial-success accounting stays intact (qty 2 → 1 ordered,
 *      1 rejected → cart shrinks to the un-bought remainder).
 *   5. M06: the confirm CTA carries whitespace-normal/text-balance so the
 *      coupon-state label wraps at ≤390px instead of overflowing.
 *
 * `@workspace/api-client-react` is mocked at the module boundary (the
 * vitest config's documented pattern for page-level component tests);
 * the cart rides the REAL CartProvider seeded via localStorage.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CheckoutPage from "@/pages/checkout";
import { CartProvider } from "@/lib/cart";

const createOrderMock = vi.fn();
const getMeMock = vi.fn(async () => ({ wallet_balance: 1_000_000 }));

vi.mock("@workspace/api-client-react", () => ({
  createOrder: (...args: unknown[]) => createOrderMock(...args),
  getGetMeQueryKey: () => ["/api/auth/me"],
  getGetWalletQueryKey: () => ["/api/wallet"],
  getListOrdersQueryKey: () => ["/api/orders"],
  getMe: (...args: unknown[]) => getMeMock(...(args as [])),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

const toastSpy = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastSpy }),
}));

/** ApiError-shaped rejection — the page detects HTTP-level failures via
 * `error.name === "ApiError"` and reads the envelope from `.data`. */
function httpApiError(error: string) {
  return Object.assign(new Error(error), {
    name: "ApiError",
    status: 409,
    data: { error, code: "NO_STOCK" },
  });
}

const KEY_SLOT = (productId: number, unit: number) =>
  `subnation_checkout_key:${productId}:${unit}`;

function seedCart(quantity: number) {
  localStorage.setItem(
    "subnation_cart_v1",
    JSON.stringify([
      {
        productId: 5,
        slug: "netflix-1m",
        name: "Netflix شهر",
        imageUrl: null,
        priceLYD: 75,
        salePriceLYD: 49,
        discountPercent: 35,
        quantity,
      },
    ]),
  );
}

function readCart(): Array<{ productId: number; quantity: number }> {
  const raw = localStorage.getItem("subnation_cart_v1");
  return raw ? (JSON.parse(raw) as Array<{ productId: number; quantity: number }>) : [];
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
  const btn = await screen.findByRole("button", { name: /تأكيد الطلب/ });
  await waitFor(() => expect(btn).toBeEnabled());
  fireEvent.click(btn);
}

describe("CheckoutPage — stable per-unit Idempotency-Keys (96-F4 / R96 A4 §2.2)", () => {
  beforeEach(() => {
    createOrderMock.mockReset();
    getMeMock.mockClear();
    toastSpy.mockReset();
    localStorage.clear();
    sessionStorage.clear();
    // The page's balance probe (/api/auth/me) must resolve a solvent
    // balance so the confirm CTA stays enabled.
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ wallet_balance: 1_000_000 }),
    })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reuses the SAME key across confirm retries after a network failure (no double charge)", async () => {
    seedCart(1);
    renderPage();

    createOrderMock.mockRejectedValueOnce(new TypeError("failed to fetch"));
    await clickConfirm();
    await waitFor(() => expect(createOrderMock).toHaveBeenCalledTimes(1));

    const key1 = createOrderMock.mock.calls[0][1].headers["Idempotency-Key"];
    expect(typeof key1).toBe("string");
    // Persisted at generation time under subnation_checkout_key:{pid}:{unit}
    expect(sessionStorage.getItem(KEY_SLOT(5, 0))).toBe(key1);

    // Retry — network state unknown, the key must be REUSED verbatim so the
    // backend replays the cached response instead of charging again.
    createOrderMock.mockRejectedValueOnce(new TypeError("failed to fetch"));
    await clickConfirm();
    await waitFor(() => expect(createOrderMock).toHaveBeenCalledTimes(2));

    const key2 = createOrderMock.mock.calls[1][1].headers["Idempotency-Key"];
    expect(key2).toBe(key1);
    // Still unresolved → still stored for the next retry.
    expect(sessionStorage.getItem(KEY_SLOT(5, 0))).toBe(key1);
    // The cart is deliberately untouched on the network path.
    expect(readCart()[0]?.quantity).toBe(1);
  });

  it("deletes the unit key once the charge is accounted (success path clears storage + cart)", async () => {
    seedCart(1);
    renderPage();

    createOrderMock.mockResolvedValueOnce({ order_code: "SNDBKEY001" });
    await clickConfirm();
    await waitFor(() => expect(createOrderMock).toHaveBeenCalledTimes(1));

    // Cart synced to exactly what was charged → empty.
    await waitFor(() => expect(readCart()).toHaveLength(0));
    // …and the accounted unit's retry key is gone.
    expect(sessionStorage.getItem(KEY_SLOT(5, 0))).toBeNull();
  });

  it("deletes the unit key on a definitive HTTP rejection so a retry mints a fresh key", async () => {
    seedCart(1);
    renderPage();

    createOrderMock.mockRejectedValueOnce(httpApiError("نفد المخزون"));
    await clickConfirm();
    await waitFor(() => expect(createOrderMock).toHaveBeenCalledTimes(1));

    // Definitive 4xx — key cleared (a cached rejection must not answer forever).
    expect(sessionStorage.getItem(KEY_SLOT(5, 0))).toBeNull();
    // The persistent money banner explains the failure (not a toast-only).
    expect(await screen.findByRole("alert")).toBeInTheDocument();

    // The retry generates a NEW key (old one was consumed by the rejection).
    createOrderMock.mockResolvedValueOnce({ order_code: "SNDBKEY002" });
    await clickConfirm();
    await waitFor(() => expect(createOrderMock).toHaveBeenCalledTimes(2));
    const retryKey = createOrderMock.mock.calls[1][1].headers["Idempotency-Key"];
    const firstKey = createOrderMock.mock.calls[0][1].headers["Idempotency-Key"];
    expect(retryKey).not.toBe(firstKey);
    await waitFor(() => expect(readCart()).toHaveLength(0));
  });

  it("keeps the partial-success accounting intact: qty 2, 1 ordered + 1 rejected → cart shrinks to 1", async () => {
    seedCart(2);
    renderPage();

    createOrderMock
      .mockResolvedValueOnce({ order_code: "SNDBKEY003" })
      .mockRejectedValueOnce(httpApiError("نفد المخزون"));
    await clickConfirm();
    await waitFor(() => expect(createOrderMock).toHaveBeenCalledTimes(2));

    // Exactly the charged unit was removed from the cart (P0-3 accounting).
    await waitFor(() => expect(readCart()[0]?.quantity).toBe(1));
    // Unit 0 charged+accounted → key cleared; unit 1 definitively rejected → cleared.
    expect(sessionStorage.getItem(KEY_SLOT(5, 0))).toBeNull();
    expect(sessionStorage.getItem(KEY_SLOT(5, 1))).toBeNull();
    // Partial-success banner names what WAS charged before the stop.
    expect(await screen.findByText(/بنجاح قبل توقف العملية/)).toBeInTheDocument();
  });

  it("M06: the confirm CTA wraps (whitespace-normal + text-balance) instead of overflowing at ≤390px", async () => {
    seedCart(1);
    renderPage();

    const btn = await screen.findByRole("button", { name: /تأكيد الطلب/ });
    // whitespace-normal overrides buttonVariants' base whitespace-nowrap via
    // twMerge; text-balance spreads the long coupon-state label evenly; the
    // fixed h-12 became min-h-12 so a 2-line label grows the button.
    expect(btn.className).toContain("whitespace-normal");
    expect(btn.className).toContain("text-balance");
    expect(btn.className).toContain("min-h-12");
    expect(btn.className).not.toContain("whitespace-nowrap");
  });

  it("P2-12: the error-banner dismiss X is a 44px target with the negative-margin trick", async () => {
    seedCart(1);
    renderPage();

    createOrderMock.mockRejectedValueOnce(httpApiError("نفد المخزون"));
    await clickConfirm();
    await waitFor(() => expect(createOrderMock).toHaveBeenCalledTimes(1));

    const dismiss = await screen.findByRole("button", { name: "إغلاق رسالة الخطأ" });
    expect(dismiss.className).toContain("h-11");
    expect(dismiss.className).toContain("w-11");
    expect(dismiss.className).toContain("-m-2");
    expect(dismiss.className).toContain("p-2");
  });
});
