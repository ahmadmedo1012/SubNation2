/**
 * R165 (the R162 ADR §2.1.1) — the checkout page's per-CONFIRM group
 * token lifecycle, through the real page:
 *
 *   1. every unit-order body of one attempt carries the SAME
 *      order_group_id (the multi-order contract client-side);
 *   2. a NETWORK failure keeps the group (like the unit keys) and the
 *      retry's bodies carry the SAME group — one logical attempt, one
 *      group, no fragmentation;
 *   3. a definitive HTTP rejection ALSO keeps the group (the cart still
 *      holds the line — same basket, same intent);
 *   4. full success (live cart fully resolved) clears the group token
 *      with the cart — the next basket mints a fresh one;
 *   5. TTL expiry: a stale envelope is treated as absent (fresh mint);
 *   6. a CORRUPT envelope (unparseable JSON) is treated as absent —
 *      a fresh mint, never a throw on the money path;
 *   7. an f:"" envelope is the never-persisted-by-us shape — fresh
 *      mint (its k is never replayed).
 *
 * Same harness as checkout-idempotency-keys.test.tsx (the module
 * boundary mock + the real CartProvider seeded via localStorage).
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
  useGetMe: vi.fn(() => ({
    data: { id: 7, wallet_balance: 1_000_000 },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  })),
  getMe: (...args: unknown[]) => getMeMock(...(args as [])),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

const toastSpy = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastSpy }),
}));

/** ApiError-shaped rejection (the page reads the envelope from `.data`). */
function httpApiError(error: string) {
  return Object.assign(new Error(error), {
    name: "ApiError",
    status: 409,
    data: { error, code: "NO_STOCK" },
  });
}

const GROUP_SLOT = "subnation_checkout_group";

function storedGroupEntry(): { k?: string; t?: number; f?: string } | null {
  const raw = localStorage.getItem(GROUP_SLOT);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as { k?: string; t?: number; f?: string };
  } catch {
    return null;
  }
}

function seedCart(lines: Array<{ productId: number; variantId: number | null; quantity: number }>) {
  localStorage.setItem(
    "subnation_cart_v2",
    JSON.stringify(
      lines.map((l) => ({
        productId: l.productId,
        variantId: l.variantId,
        variantLabel: "شهر واحد",
        slug: `p-${l.productId}`,
        name: `منتج ${l.productId}`,
        imageUrl: null,
        priceLYD: 75,
        salePriceLYD: 49,
        discountPercent: 35,
        quantity: l.quantity,
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

/** The order_group_id sent on the Nth createOrder call's BODY. */
function bodyGroupOf(call: number): string | null | undefined {
  return (createOrderMock.mock.calls[call][0] as { order_group_id?: string | null })
    ?.order_group_id;
}

describe("CheckoutPage — the per-confirm group token (R165, the R162 ADR)", () => {
  beforeEach(() => {
    createOrderMock.mockReset();
    getMeMock.mockClear();
    toastSpy.mockReset();
    localStorage.clear();
    window.history.pushState(null, "", "/");
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

  it("every unit body of one attempt carries the SAME order_group_id (persisted at mint)", async () => {
    seedCart([
      { productId: 5, variantId: 101, quantity: 3 },
      { productId: 9, variantId: null, quantity: 1 },
    ]);
    renderPage();

    createOrderMock.mockImplementation(async () => ({ order_code: "SN-GRP" }));
    await clickConfirm();
    await waitFor(() => expect(createOrderMock).toHaveBeenCalledTimes(4));

    const ids = [0, 1, 2, 3].map((c) => bodyGroupOf(c));
    ids.forEach((id) => expect(typeof id).toBe("string"));
    expect(new Set(ids).size).toBe(1); // ONE group for the whole attempt

    // Persisted at mint time (for the retry contract), bound to the
    // basket's line keys (no quantities, no coupon).
    const entry = storedGroupEntry();
    expect(entry?.k).toBe(ids[0]);
    expect(entry?.f).toBe("5:101|9:0");
  });

  it("a NETWORK failure keeps the group — the retry's bodies carry the SAME group (no fragmentation)", async () => {
    seedCart([{ productId: 5, variantId: 101, quantity: 1 }]);
    renderPage();

    createOrderMock.mockRejectedValueOnce(new TypeError("failed to fetch"));
    await clickConfirm();
    await waitFor(() => expect(createOrderMock).toHaveBeenCalledTimes(1));
    const firstGroup = bodyGroupOf(0);
    expect(typeof firstGroup).toBe("string");
    // The group SURVIVES the network unknown (like the unit keys).
    expect(storedGroupEntry()?.k).toBe(firstGroup);

    createOrderMock.mockResolvedValueOnce({ order_code: "SN-GRP-RETRY" });
    await clickConfirm();
    await waitFor(() => expect(createOrderMock).toHaveBeenCalledTimes(2));

    expect(bodyGroupOf(1)).toBe(firstGroup); // SAME group on the retry
    // Full resolution → the group is cleared with the cart.
    await waitFor(() => expect(readCart()).toHaveLength(0));
    await waitFor(() => expect(storedGroupEntry()).toBeNull());
  });

  it("a definitive HTTP rejection KEEPS the group (same basket, same intent — the retry reuses it)", async () => {
    seedCart([{ productId: 5, variantId: 101, quantity: 2 }]);
    renderPage();

    // Unit 0 succeeds, unit 1 is definitively rejected → partial success,
    // the cart keeps the 1-unit remainder (same basket).
    createOrderMock
      .mockResolvedValueOnce({ order_code: "SN-GRP-P0" })
      .mockRejectedValueOnce(httpApiError("نفد المخزون"));
    await clickConfirm();
    await waitFor(() => expect(createOrderMock).toHaveBeenCalledTimes(2));

    const group = bodyGroupOf(0);
    expect(bodyGroupOf(1)).toBe(group);
    // The remainder cart holds the line → the group stays for the retry.
    expect(storedGroupEntry()?.k).toBe(group);
    expect(readCart()[0]?.quantity).toBe(1);

    // The retry of the remainder rides the SAME group.
    createOrderMock.mockResolvedValueOnce({ order_code: "SN-GRP-P1" });
    await clickConfirm();
    await waitFor(() => expect(createOrderMock).toHaveBeenCalledTimes(3));
    expect(bodyGroupOf(2)).toBe(group);

    await waitFor(() => expect(readCart()).toHaveLength(0));
    await waitFor(() => expect(storedGroupEntry()).toBeNull());
  });

  it("TTL expiry: a stale envelope is treated as absent (fresh group on a late retry)", async () => {
    seedCart([{ productId: 5, variantId: 101, quantity: 1 }]);
    renderPage();

    createOrderMock.mockRejectedValueOnce(new TypeError("failed to fetch"));
    await clickConfirm();
    await waitFor(() => expect(createOrderMock).toHaveBeenCalledTimes(1));
    const firstGroup = bodyGroupOf(0);

    // Age the stored envelope past the 10-minute TTL (98-F2 trade-off:
    // a >10-min-late retry mints a fresh group alongside fresh unit keys).
    const entry = storedGroupEntry();
    expect(entry).not.toBeNull();
    localStorage.setItem(GROUP_SLOT, JSON.stringify({ ...entry, t: Date.now() - 11 * 60 * 1000 }));

    createOrderMock.mockResolvedValueOnce({ order_code: "SN-GRP-LATE" });
    await clickConfirm();
    await waitFor(() => expect(createOrderMock).toHaveBeenCalledTimes(2));
    expect(bodyGroupOf(1)).not.toBe(firstGroup); // fresh group, fresh mint
    await waitFor(() => expect(storedGroupEntry()).toBeNull()); // full resolution
  });

  it("a CORRUPT envelope (unparseable JSON) is treated as absent — fresh mint, no throw", async () => {
    seedCart([{ productId: 5, variantId: 101, quantity: 1 }]);
    renderPage();

    createOrderMock.mockRejectedValueOnce(new TypeError("failed to fetch"));
    await clickConfirm();
    await waitFor(() => expect(createOrderMock).toHaveBeenCalledTimes(1));
    const firstGroup = bodyGroupOf(0);

    // Corrupt the stored envelope between attempts — the load's catch
    // must treat it as absent (the intent-envelope corruption guard):
    // a fresh mint, never a throw on the money path.
    localStorage.setItem(GROUP_SLOT, "{corrupt-envelope");

    createOrderMock.mockResolvedValueOnce({ order_code: "SN-GRP-CORRUPT" });
    await clickConfirm();
    await waitFor(() => expect(createOrderMock).toHaveBeenCalledTimes(2));
    expect(typeof bodyGroupOf(1)).toBe("string");
    expect(bodyGroupOf(1)).not.toBe(firstGroup); // fresh mint, not the corrupt entry
    await waitFor(() => expect(readCart()).toHaveLength(0));
    await waitFor(() => expect(storedGroupEntry()).toBeNull()); // full resolution
  });

  it('an f:"" envelope is the never-persisted-by-us shape — fresh mint (its k is never replayed)', async () => {
    seedCart([{ productId: 5, variantId: 101, quantity: 1 }]);
    renderPage();

    createOrderMock.mockRejectedValueOnce(new TypeError("failed to fetch"));
    await clickConfirm();
    await waitFor(() => expect(createOrderMock).toHaveBeenCalledTimes(1));
    const firstGroup = bodyGroupOf(0);

    // Empty fingerprint = an envelope this module never wrote — the
    // parsed.f === "" guard must reject it even though k/t are still
    // well-formed (the stored k must NOT be replayed onto it).
    const entry = storedGroupEntry();
    expect(entry).not.toBeNull();
    localStorage.setItem(GROUP_SLOT, JSON.stringify({ ...entry, f: "" }));

    createOrderMock.mockResolvedValueOnce({ order_code: "SN-GRP-EMPTYF" });
    await clickConfirm();
    await waitFor(() => expect(createOrderMock).toHaveBeenCalledTimes(2));
    expect(bodyGroupOf(1)).not.toBe(firstGroup); // fresh mint — k not replayed
    await waitFor(() => expect(readCart()).toHaveLength(0));
    await waitFor(() => expect(storedGroupEntry()).toBeNull()); // full resolution
  });

  it("a genuinely DIFFERENT basket mints a fresh group (no cross-basket bleed within the TTL)", async () => {
    seedCart([{ productId: 5, variantId: 101, quantity: 1 }]);
    const { unmount } = renderPage();

    // An unresolved attempt leaves the group live…
    createOrderMock.mockRejectedValueOnce(new TypeError("failed to fetch"));
    await clickConfirm();
    await waitFor(() => expect(createOrderMock).toHaveBeenCalledTimes(1));
    expect(storedGroupEntry()).not.toBeNull();

    // …the shopper abandons that basket and confirms an entirely different
    // one within the TTL — a fresh page mount reads the new basket, and the
    // overlap check mints a FRESH group instead of gluing two intents
    // together.
    unmount();
    seedCart([{ productId: 77, variantId: 55, quantity: 1 }]);
    renderPage();
    createOrderMock.mockResolvedValueOnce({ order_code: "SN-GRP-NEW" });
    await clickConfirm();
    await waitFor(() => expect(createOrderMock).toHaveBeenCalledTimes(2));
    expect(bodyGroupOf(1)).not.toBe(bodyGroupOf(0));
    await waitFor(() => expect(storedGroupEntry()).toBeNull());
  });
});
