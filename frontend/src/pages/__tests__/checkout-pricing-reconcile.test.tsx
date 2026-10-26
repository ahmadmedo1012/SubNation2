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
vi.mock("@/hooks/useToast", () => ({
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
  // R129-A1 (B-11 wiring): the line carries the stock snapshot captured
  // at add time — 12, matching the live row (stock_count: 12) so the
  // "no change" case below is genuinely identity-stable (price AND
  // stock agree with the re-quote). The legacy no-snapshot shape is
  // covered by the new stock-drift case.
  stockCount: 12,
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

  it("G-3 (R142): a 404 landing after remove-then-re-ADD of the same key does NOT remove the re-added line", async () => {
    // The stale-closure drop: the re-quote effect captured the ORIGINAL
    // items snapshot (qty 2); while the quote is in flight the shopper
    // removes the line and re-adds the same (productId, variantId) —
    // the re-add lands in localStorage with the add-time quantity (1).
    // The old code matched the RE-ADDED line by key and removed it on
    // the (possibly transient) 404 verdict; the G-3 guard compares the
    // live line's quantity against the stale snapshot's — superseded
    // intent fails the equality and SURVIVES.
    seedCart();
    let resolveQuote: (v: never) => void = () => {};
    getProductMock.mockReturnValue(
      new Promise((_resolve, _reject) => {
        resolveQuote = _reject as (v: never) => void;
      }),
    );
    renderPage();

    // While the quote is in flight: remove + re-add the same key with
    // the re-add's fresh quantity (1 ≠ the snapshot's 2) — written
    // straight to storage exactly like a cross-tab edit would land.
    await act(async () => {
      const readded = [{ ...CART_ITEM, quantity: 1 }];
      localStorage.setItem("subnation_cart_v2", JSON.stringify(readded));
    });

    // The (transient) 404 verdict lands.
    await act(async () => {
      resolveQuote(httpApiError("المنتج غير موجود", 404) as never);
    });

    // The re-added line SURVIVES: no drop notice, the cart was not
    // emptied by the stale verdict (the server re-validates at charge).
    await waitFor(() => {
      expect(getProductMock).toHaveBeenCalled();
    });
    await act(async () => {});
    expect(screen.queryByText(/أُزيل من الطلب/)).not.toBeInTheDocument();
    expect(screen.queryByText("سلتك فارغة")).not.toBeInTheDocument();
    expect(readCart()).toHaveLength(1);
    expect(readCart()[0].quantity).toBe(1);
  });

  it("no change: silent — no notices, snapshot totals stand, CTA usable", async () => {
    seedCart();
    getProductMock.mockResolvedValue(liveProduct()); // byte-identical pricing + stock
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

  it("stock drift (B-11 wiring, R129-A1): the re-quote silently refreshes the line's stock snapshot — no price notice", async () => {
    // A legacy line (pre-B-11 shape: no stockCount) meets a live row
    // with stock_count 12 — the re-quote refreshes the snapshot ALONGSIDE
    // price, silently (stock drift is not a price change; the totals
    // stand) and stays identity-stable on the SECOND pass (no loop).
    const legacyItem: LocalCartItem = { ...CART_ITEM, stockCount: undefined };
    localStorage.setItem("subnation_cart_v2", JSON.stringify([legacyItem]));
    getProductMock.mockResolvedValue(liveProduct());
    renderPage();

    const cta = await screen.findByRole("button", { name: /إتمام الطلب/ });
    await waitFor(() => expect(cta).toBeEnabled());
    // No price notice — only the snapshot's stock changed.
    expect(screen.queryByText(PRICE_NOTICE)).not.toBeInTheDocument();
    // The stored line now carries the live stock.
    const stored = readCart()[0];
    expect(stored.stockCount).toBe(12);
    expect(stored.salePriceLYD).toBe(49); // price untouched
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

  it("B-F1 (R188-6): two OVERLAPPING flights — the first landing while the second is pending keeps the CTA locked", async () => {
    // The cross-tab window (lib/cart.tsx:407-415): while the mount
    // requote (product 5) is in flight, another tab adds a NEW unquoted
    // product (6) — the storage-event re-sync re-runs the effect and
    // arms a SECOND flight. The boolean gate let the FIRST flight's
    // finally clear the shared flag (the CTA unlocked with product 6's
    // live price still unreconciled — the 98-F2 class, narrow
    // reintroduction); the flight counter clears only when the LAST
    // flight lands.
    seedCart();
    let release5!: (value: unknown) => void;
    let release6!: (value: unknown) => void;
    getProductMock.mockImplementation((id: number) =>
      id === 5
        ? new Promise((resolve) => {
            release5 = resolve;
          })
        : new Promise((resolve) => {
            release6 = resolve;
          }),
    );
    renderPage();

    // Flight 1 (product 5) pending → the CTA wears the in-flight label.
    const cta = await screen.findByRole("button", { name: /جارٍ تحديث الأسعار/ });
    expect(cta).toBeDisabled();

    // The cross-tab add: the new line (product 6, variant 102, 20.00)
    // lands through the storage event → the effect arms flight 2 for
    // the NEW id only (5 is already quoted).
    const added: LocalCartItem = {
      ...CART_ITEM,
      productId: 6,
      variantId: 102,
      variantLabel: "سنة واحدة",
      slug: "netflix-1y",
      name: "Netflix سنة",
      priceLYD: 20,
      salePriceLYD: null,
      discountPercent: null,
      quantity: 1,
    };
    const nextCart = JSON.stringify([CART_ITEM, added]);
    await act(async () => {
      localStorage.setItem("subnation_cart_v2", nextCart);
      window.dispatchEvent(
        new StorageEvent("storage", { key: "subnation_cart_v2", newValue: nextCart }),
      );
    });
    await waitFor(() => expect(getProductMock).toHaveBeenCalledWith(6));

    // Flight 1 lands with CHANGED pricing (the sale ended: 49 → 75).
    // Waiting for the repriced line total proves flight 1's continuation
    // ran THROUGH its finally (same render batch) — while flight 2 is
    // STILL pending, the CTA must stay locked: this is the exact
    // assertion the boolean accounting failed (the first finally
    // unlocked the confirm while product 6's price was unreconciled).
    await act(async () => {
      release5(
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
    });
    expect(await screen.findAllByText("150.00 د.ل")).toHaveLength(1);
    expect(screen.getByRole("button", { name: /جارٍ تحديث الأسعار/ })).toBeDisabled();

    // The LAST flight lands (product 6, byte-identical pricing →
    // silent) → the gate clears and the CTA sells the reconciled grand
    // total (75×2 + 20 = 170).
    await act(async () => {
      release6(
        liveProduct({
          id: 6,
          slug: "netflix-1y",
          name: "Netflix سنة",
          price: 20,
          sale_price: null,
          discount_percent: null,
          variants: [
            {
              id: 102,
              plan_label: null,
              duration_label: "سنة واحدة",
              label: "سنة واحدة",
              price: 20,
              sale_price: null,
              discount_percent: null,
              is_available: true,
            },
          ],
        }),
      );
    });
    await waitFor(() => expect(cta).toBeEnabled());
    await waitFor(() => expect(cta.textContent).toContain("170.00 د.ل"));
  });
});
