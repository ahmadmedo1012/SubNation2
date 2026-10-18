/**
 * L5-3 (R143) — an INSUFFICIENT_BALANCE server rejection reseeds the me
 * cache so the on-screen balance chip matches the verdict.
 *
 * The complete-failure branch used to only set the banner + toast: the
 * balance chip kept rendering the 60 s-stale me.wallet_balance (and the
 * client-side insufficient gate keyed off the same figure) — after the
 * server's definitive rejection the page showed a sufficient-looking
 * balance NEXT to an error banner saying otherwise, self-healing only
 * after the staleTime + a remount.
 *
 * Pinned here (behavioral, through the REAL generated client):
 *   1. /api/auth/me mounts with a stale-high balance;
 *   2. the unit POST rejects with the ApiError envelope
 *      {code: INSUFFICIENT_BALANCE};
 *   3. the no-store me probe RE-FIRES (call #2) and its FRESH figure is
 *      seeded into the query cache;
 *   4. the client-side insufficient banner («رصيد المحفظة غير كافٍ
 *      (الناقص … د.ل») + the topup return-link) renders off the FRESH
 *      figure — the chip and the verdict agree.
 *
 * Harness: the loyalty-convert-journey idiom — `@workspace/api-client-
 * react` mocked with importOriginal so the REAL useGetMe/getMe/getProduct
 * (customFetch and all) ride the stubbed global fetch; only createOrder
 * is pinned at the module boundary. The cart rides the real
 * CartProvider seeded via localStorage.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CheckoutPage from "@/pages/checkout";
import { CartProvider } from "@/lib/cart";

const createOrderMock = vi.fn();

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/api-client-react")>();
  return {
    ...actual,
    createOrder: (...args: unknown[]) => createOrderMock(...(args as [])),
  };
});

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

const toastSpy = vi.fn();
vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({ toast: toastSpy }),
}));

/** The ApiError envelope customFetch throws for non-2xx — the page
 * classifies via `error.name === "ApiError"` + `.data`. */
function insufficientBalanceError() {
  return Object.assign(new Error("رصيد المحفظة غير كافٍ. يرجى شحن المحفظة أولاً"), {
    name: "ApiError",
    status: 400,
    data: {
      error: "رصيد المحفظة غير كافٍ. يرجى شحن المحفظة أولاً",
      code: "INSUFFICIENT_BALANCE",
    },
  });
}

/** Live product row matching the cart snapshot (no drift notices). */
function liveProduct() {
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
    stock_count: 5,
    order_count: 0,
    variants: [
      {
        id: 101,
        plan_label: "Basic",
        duration_label: "شهر واحد",
        label: "Basic — شهر واحد",
        price: 75,
        sale_price: 49,
        discount_percent: 35,
        is_available: true,
      },
    ],
  };
}

function resLike(over: { status?: number; body?: unknown; contentType?: string } = {}) {
  const { status = 200, body = {}, contentType = "application/json" } = over;
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": contentType },
  });
}

function seedCart() {
  localStorage.setItem(
    "subnation_cart_v2",
    JSON.stringify([
      {
        productId: 5,
        variantId: 101,
        variantLabel: "شهر واحد",
        slug: "netflix-1m",
        name: "Netflix شهر",
        imageUrl: null,
        priceLYD: 75,
        salePriceLYD: 49,
        discountPercent: 35,
        quantity: 1,
      },
    ]),
  );
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

describe("CheckoutPage — INSUFFICIENT_BALANCE reseeds the me cache (L5-3)", () => {
  let meFetchCalls: number[];

  beforeEach(() => {
    createOrderMock.mockReset();
    toastSpy.mockReset();
    localStorage.clear();
    meFetchCalls = [0];
    Element.prototype.scrollIntoView = vi.fn();

    // /api/auth/me: call 1 (mount) = the STALE-HIGH balance the gate
    // trusts; call 2+ (the L5-3 no-store probe) = the FRESH low figure
    // the server's rejection implies.
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/auth/me") {
        meFetchCalls[0] += 1;
        return resLike({
          body:
            meFetchCalls[0] === 1
              ? { id: 7, wallet_balance: 1_000_000 }
              : { id: 7, wallet_balance: 10 },
        });
      }
      if (url === "/api/products/5") return resLike({ body: liveProduct() });
      return resLike({ body: {} });
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("the failure re-fires the me probe, seeds the FRESH balance, and the insufficient banner + topup link render off it", async () => {
    seedCart();
    renderPage();

    // Mount: the chip renders the stale-high balance (solvent → no
    // insufficient banner yet; the CTA is enabled).
    await waitFor(() => expect(meFetchCalls[0]).toBe(1));
    expect(screen.queryByText(/رصيد المحفظة غير كافٍ/)).not.toBeInTheDocument();

    // The server's definitive rejection.
    createOrderMock.mockRejectedValueOnce(insufficientBalanceError());
    await clickConfirm();
    await waitFor(() => expect(createOrderMock).toHaveBeenCalledTimes(1));

    // The persistent money banner carries the server's Arabic sentence.
    expect(
      await screen.findByText(/رصيد المحفظة غير كافٍ\. يرجى شحن المحفظة أولاً/),
    ).toBeInTheDocument();

    // L5-3: the me probe RE-FIRED (the no-store refresh)…
    await waitFor(() => expect(meFetchCalls[0]).toBeGreaterThanOrEqual(2));

    // …and the FRESH (low) figure now drives the CLIENT-side insufficient
    // banner — the exact contradiction L5-3 filed (chip says solvent,
    // banner says otherwise) is gone: «الناقص» = 49 − 10 = 39 د.ل.
    const banner = await screen.findByText(/رصيد المحفظة غير كافٍ \(الناقص/);
    expect(banner.textContent).toContain("39.00");
    // The topup return-link (the only path back into this checkout).
    expect(screen.getByRole("link", { name: "اشحن المحفظة ثم عُد لإتمام الطلب" })).toHaveAttribute(
      "href",
      "/wallet?return=/checkout",
    );
  });

  it("a NON-balance failure does NOT fire the extra me probe (the reseed is balance-class only)", async () => {
    seedCart();
    renderPage();

    await waitFor(() => expect(meFetchCalls[0]).toBe(1));

    createOrderMock.mockRejectedValueOnce(
      Object.assign(new Error("نفد المخزون"), {
        name: "ApiError",
        status: 409,
        data: { error: "نفد المخزون", code: "OUT_OF_STOCK" },
      }),
    );
    await clickConfirm();
    await waitFor(() => expect(createOrderMock).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/نفد المخزون/)).toBeInTheDocument();

    // Give any stray refetch a tick to land, then assert the probe never
    // re-fired (balance-class reseed only — no extra /me traffic).
    await new Promise((r) => setTimeout(r, 25));
    expect(meFetchCalls[0]).toBe(1);
  });
});
