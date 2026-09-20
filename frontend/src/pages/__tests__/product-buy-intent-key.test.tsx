/**
 * 97-F5 (R97-A4 §2 / F-02 + §3 / F-06) — product-page single-purchase
 * intent-key + invalidation tests.
 *
 * The buy-intent Idempotency-Key used to live in a useRef, so it died
 * with the component: a refresh / back-navigation / PWA cold-resume
 * after a NETWORK-level failure (response lost, wallet already charged)
 * minted a FRESH key on the re-tap → a second order + a second
 * deduction. These tests pin the sessionStorage lifecycle that mirrors
 * checkout.tsx (96-F4):
 *
 *   1. NETWORK failure → the stored key SURVIVES (TTL + fingerprint
 *      stamped) and the retry REUSES it verbatim (same header on the
 *      second createOrder) — the double-charge fix, now surviving
 *      unmount/refresh.
 *   2. Success → the key is DELETED and /api/wallet + /api/orders are
 *      invalidated (F-06: /wallet renders wallet.balance, a different
 *      data point than me.wallet_balance — it used to stay stale for
 *      ≤60 s right after the charge).
 *   3. Definitive HTTP rejection (ApiError) → the key is DELETED so a
 *      retry isn't answered forever by the cached rejection.
 *   4. TTL: a stored key older than 10 minutes is IGNORED (fresh key
 *      minted) — a stale intent must never swallow a NEW purchase via
 *      the server's 24 h replay window (F-07's lesson).
 *   5. Fingerprint binding: a stored key minted for a different price
 *      is IGNORED (fresh key) — a stale intent is never replayed onto
 *      changed data.
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
const getMeMock = vi.fn(async () => ({ id: 7, wallet_balance: 1_000_000 }));

const PRODUCT = {
  id: 5,
  slug: null,
  name: "Netflix شهر",
  description: "اشتراك شهري",
  category: "streaming",
  price: 49,
  sale_price: null,
  image_url: null,
  is_active: true,
  is_available: true,
  stock_count: 12,
  discount_percent: null,
  usage_terms: null,
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

/** ApiError-shaped rejection — the page detects HTTP-level failures via
 * `error.name === "ApiError"` (same helper shape as the checkout tests). */
function httpApiError(error: string) {
  return Object.assign(new Error(error), {
    name: "ApiError",
    status: 409,
    data: { error, code: "NO_STOCK" },
  });
}

const KEY_SLOT = (productId: number) => `subnation_buykey:${productId}`;

function readStoredIntent(productId: number): { k: string; t: number; f: string } | null {
  const raw = sessionStorage.getItem(KEY_SLOT(productId));
  return raw ? (JSON.parse(raw) as { k: string; t: number; f: string }) : null;
}

let queryClient: QueryClient;

function renderPage() {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  window.history.pushState({}, "", `/product/${PRODUCT.id}`);
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
  // act-wrapped: the async handleBuyIntent resolves (success banner /
  // error state) inside the act scope — no update leaks past the test.
  await act(async () => {
    fireEvent.click(btn);
  });
}

beforeEach(() => {
  createOrderMock.mockReset();
  getMeMock.mockClear();
  toastSpy.mockReset();
  sessionStorage.clear();
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ProductPage — sessionStorage buy-intent key (97-F5 F-02)", () => {
  it("keeps the key across a network failure and REUSES it on the retry (no double charge)", async () => {
    renderPage();

    createOrderMock.mockRejectedValueOnce(new TypeError("failed to fetch"));
    await clickBuy();
    await waitFor(() => expect(createOrderMock).toHaveBeenCalledTimes(1));

    const key1 = createOrderMock.mock.calls[0][1].headers["Idempotency-Key"];
    expect(typeof key1).toBe("string");
    // Persisted BEFORE the request, under subnation_buykey:{productId},
    // stamped with the mint time + the price/coupon fingerprint.
    const stored = readStoredIntent(PRODUCT.id);
    expect(stored).not.toBeNull();
    expect(stored!.k).toBe(key1);
    expect(stored!.f).toBe(`${PRODUCT.id}|${PRODUCT.price}||`);
    expect(typeof stored!.t).toBe("number");

    // Refresh-survival simulation: the retry reads the key back from
    // sessionStorage (the useRef is gone — this is the F-02 fix).
    createOrderMock.mockRejectedValueOnce(new TypeError("failed to fetch"));
    await clickBuy();
    await waitFor(() => expect(createOrderMock).toHaveBeenCalledTimes(2));

    const key2 = createOrderMock.mock.calls[1][1].headers["Idempotency-Key"];
    expect(key2).toBe(key1);
    // Still unresolved → still stored for the next retry.
    expect(readStoredIntent(PRODUCT.id)?.k).toBe(key1);
  });

  it("clears the key on success AND invalidates /api/wallet + /api/orders (F-06)", async () => {
    renderPage();

    // The pre-purchase money caches a fresh buyer holds.
    queryClient.setQueryData(["/api/wallet"], { balance: 1_000_000 });
    queryClient.setQueryData(["/api/orders"], []);

    createOrderMock.mockResolvedValueOnce({
      order_code: "SNDBUY001",
      delivered_email: "a@b.c",
      delivered_password: "pw",
    });
    await clickBuy();
    await waitFor(() => expect(createOrderMock).toHaveBeenCalledTimes(1));

    // The order success screen is up — the intent is terminally resolved.
    await waitFor(() => expect(screen.getByText("تم الشراء بنجاح!")).toBeInTheDocument());
    expect(sessionStorage.getItem(KEY_SLOT(PRODUCT.id))).toBeNull();

    // F-06: the wallet page's OWN data point is invalidated alongside
    // the orders list — /wallet must not show the pre-purchase balance
    // for the next 60 s.
    await waitFor(() => {
      expect(queryClient.getQueryState(["/api/wallet"])?.isInvalidated).toBe(true);
    });
    expect(queryClient.getQueryState(["/api/orders"])?.isInvalidated).toBe(true);
  });

  it("clears the key on a definitive HTTP rejection so a retry mints a fresh key", async () => {
    renderPage();

    createOrderMock.mockRejectedValueOnce(httpApiError("نفد المخزون"));
    await clickBuy();
    await waitFor(() => expect(createOrderMock).toHaveBeenCalledTimes(1));

    // Definitive 4xx — key cleared (a cached rejection must not answer forever).
    expect(sessionStorage.getItem(KEY_SLOT(PRODUCT.id))).toBeNull();
    expect(await screen.findByRole("alert")).toBeInTheDocument();

    // The retry generates a NEW key (old one consumed by the rejection).
    createOrderMock.mockResolvedValueOnce({ order_code: "SNDBUY002" });
    await clickBuy();
    await waitFor(() => expect(createOrderMock).toHaveBeenCalledTimes(2));
    const retryKey = createOrderMock.mock.calls[1][1].headers["Idempotency-Key"];
    const firstKey = createOrderMock.mock.calls[0][1].headers["Idempotency-Key"];
    expect(retryKey).not.toBe(firstKey);
  });

  it("99-M2: KEEPS the key on a 409 IDEMPOTENCY_IN_FLIGHT rejection (transient — the retry must replay, never re-execute)", async () => {
    renderPage();

    // The same-key request is still executing server-side (this attempt
    // merely raced it, e.g. a double-tap the client cancelled). Clearing
    // the key here would mint a fresh key on retry and DOUBLE-CHARGE once
    // the in-flight request commits — the exact bug 99-M2 closes.
    const inFlight = Object.assign(
      new Error("طلب سابق بنفس المعرف لا يزال قيد المعالجة. حاول مرة أخرى بعد قليل."),
      {
        name: "ApiError",
        status: 409,
        data: {
          error: "طلب سابق بنفس المعرف لا يزال قيد المعالجة. حاول مرة أخرى بعد قليل.",
          code: "IDEMPOTENCY_IN_FLIGHT",
        },
      },
    );
    createOrderMock.mockRejectedValueOnce(inFlight);
    await clickBuy();
    await waitFor(() => expect(createOrderMock).toHaveBeenCalledTimes(1));

    // The key SURVIVES the transient 409…
    expect(readStoredIntent(PRODUCT.id)).not.toBeNull();
    expect(await screen.findByRole("alert")).toBeInTheDocument();

    // …so the retry REUSES it (replay) instead of minting a fresh one.
    createOrderMock.mockResolvedValueOnce({ order_code: "SNDBUY003" });
    await clickBuy();
    await waitFor(() => expect(createOrderMock).toHaveBeenCalledTimes(2));
    const retryKey = createOrderMock.mock.calls[1][1].headers["Idempotency-Key"];
    const firstKey = createOrderMock.mock.calls[0][1].headers["Idempotency-Key"];
    expect(retryKey).toBe(firstKey);
    // The replay's success then clears it (terminal resolution).
    expect(sessionStorage.getItem(KEY_SLOT(PRODUCT.id))).toBeNull();
  });

  it("ignores a stored key older than the 10-minute TTL (fresh key minted)", async () => {
    renderPage();

    // A stale retry token left from an abandoned attempt long ago.
    sessionStorage.setItem(
      KEY_SLOT(PRODUCT.id),
      JSON.stringify({
        k: "stale-key-uuid",
        t: Date.now() - 11 * 60 * 1000,
        f: `${PRODUCT.id}|${PRODUCT.price}||`,
      }),
    );

    createOrderMock.mockRejectedValueOnce(new TypeError("failed to fetch"));
    await clickBuy();
    await waitFor(() => expect(createOrderMock).toHaveBeenCalledTimes(1));

    const usedKey = createOrderMock.mock.calls[0][1].headers["Idempotency-Key"];
    expect(usedKey).not.toBe("stale-key-uuid");
    // The fresh attempt OVERWRITES the stale entry (new stamp, new TTL).
    expect(readStoredIntent(PRODUCT.id)?.k).toBe(usedKey);
  });

  it("ignores a stored key minted for a DIFFERENT price (fingerprint binding)", async () => {
    renderPage();

    // The product's price changed since the key was minted — replaying
    // the old intent would swallow a genuinely new purchase (or trip
    // the backend's same-key-different-body 409).
    sessionStorage.setItem(
      KEY_SLOT(PRODUCT.id),
      JSON.stringify({ k: "other-price-key", t: Date.now(), f: `${PRODUCT.id}|99|` }),
    );

    createOrderMock.mockRejectedValueOnce(new TypeError("failed to fetch"));
    await clickBuy();
    await waitFor(() => expect(createOrderMock).toHaveBeenCalledTimes(1));

    const usedKey = createOrderMock.mock.calls[0][1].headers["Idempotency-Key"];
    expect(usedKey).not.toBe("other-price-key");
    expect(readStoredIntent(PRODUCT.id)?.f).toBe(`${PRODUCT.id}|${PRODUCT.price}||`);
  });
});
