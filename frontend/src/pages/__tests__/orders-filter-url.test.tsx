/**
 * R126-L6 (A9-3) — orders filter chips ↔ ?filter= URL mirror.
 *
 * The bucket chips were local state only (orders.tsx `useState<OrderFilter>`
 * with no searchParams anywhere): a pull-to-refresh on the installed PWA
 * reset «قيد الانتظار» → «الكل», and deep-linking "your pending orders"
 * into a WhatsApp support conversation was impossible. The home/admin
 * ?tab= idiom (R98-04 — whitelisted mount read + replaceState mirror,
 * no history spam) now applies.
 *
 * Pinned here:
 *   • mount WITH ?filter=pending ⇒ the pending chip is pressed and only
 *     pending rows render (a shared/refreshed link keeps its bucket);
 *   • changing the chip mirrors into the querystring via replaceState
 *     (and back to «الكل» strips the param — the bare /orders URL stays
 *     canonical);
 *   • a bogus ?filter= value is whitelisted away (no phantom bucket).
 *
 * Harness: the orders-load-more.test.tsx pattern — real QueryClient +
 * the mocked global fetch over the raw /api/orders?page=N URL.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OrdersPage from "@/pages/orders";

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

const ORDER = (i: number, status: string) => ({
  id: i,
  order_code: `SNDB${String(i).padStart(4, "0")}`,
  status,
  amount: 25,
  product_name: `منتج رقم ${i}`,
  product_image_url: null,
  variant_label: null,
  created_at: "2026-09-08T10:00:00.000Z",
});

const jsonRes = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => jsonRes([ORDER(1, "pending"), ORDER(2, "completed")]));
  vi.stubGlobal("fetch", fetchMock);
  window.history.pushState(null, "", "/orders");
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.pushState(null, "", "/orders");
});

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <Router>
        <OrdersPage />
      </Router>
    </QueryClientProvider>,
  );
}

describe("OrdersPage — filter chips ↔ ?filter= URL (A9-3, R126-L6)", () => {
  it("mounts with ?filter=pending: the pending chip is pressed and only pending rows render", async () => {
    window.history.pushState(null, "", "/orders?filter=pending");
    renderPage();

    await waitFor(() => expect(screen.getByText(/منتج رقم 1$/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /قيد الانتظار/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: /^الكل/ })).toHaveAttribute("aria-pressed", "false");
    // The bucket actually filters: the pending row shows, the completed
    // one doesn't.
    expect(screen.getByText(/منتج رقم 1$/)).toBeInTheDocument();
    expect(screen.queryByText(/منتج رقم 2$/)).not.toBeInTheDocument();
  });

  it("changing chips mirrors the bucket into the querystring; «الكل» strips it back to the bare path", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/منتج رقم 1$/)).toBeInTheDocument());

    // pending → mirror.
    fireEvent.click(screen.getByRole("button", { name: /قيد الانتظار/ }));
    await waitFor(() => {
      expect(window.location.search).toBe("?filter=pending");
    });

    // completed → mirror (param replaced, not stacked).
    fireEvent.click(screen.getByRole("button", { name: /^مكتمل/ }));
    await waitFor(() => {
      expect(window.location.search).toBe("?filter=completed");
    });

    // back to «الكل» → the param strips; the bare /orders URL is the
    // canonical form again.
    fireEvent.click(screen.getByRole("button", { name: /^الكل/ }));
    await waitFor(() => {
      expect(window.location.search).toBe("");
    });
  });

  it("a bogus ?filter= value is whitelisted away (the «الكل» chip stays armed)", async () => {
    window.history.pushState(null, "", "/orders?filter=bogus");
    renderPage();

    await waitFor(() => expect(screen.getByText(/منتج رقم 1$/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /^الكل/ })).toHaveAttribute("aria-pressed", "true");
    // No mirror of the bogus value either — the whitelisted state owns
    // the URL.
    await waitFor(() => {
      expect(window.location.search).toBe("");
    });
  });
});
