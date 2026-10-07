/**
 * R115-I1 (A8 P2-3) — refund visibility: refunded ≠ failed.
 *
 * The audit found a tonal contradiction on refunded orders: the status
 * PILL was blue status-info (utils.ts statusColor) while the row icon,
 * the card accent and the order-detail header bar were ERROR red, and
 * the refund message showed no amount and never disclosed the loyalty
 * points reversal refund.service performs. These tests pin:
 *
 *  orders list (orders.tsx):
 *   • the refunded row's icon is the calm undo glyph (info tone), never
 *     the failure XCircle, and its accent border is status-info;
 *   • the row carries the refund receipt chip
 *     «استُرد X د.ل إلى محفظتك» (the amount IS orders.amount — the
 *     full figure RefundService credits back, terminal-state guarded).
 *
 *  order detail (order-detail.tsx):
 *   • the refund card's info tone (header bar + card border + undo
 *     glyph) instead of the error red it shared with failed orders;
 *   • the receipt line names the AMOUNT
 *     («استُرد X د.ل إلى محفظتك تلقائياً»);
 *   • the honest tail discloses the points reversal
 *     («خُصمت نقاط الشراء المستردة») — points silently vanishing from
 *     /loyalty with no explanation was an undisclosed money-adjacent
 *     movement.
 *
 * `@workspace/api-client-react` is mocked at the module boundary (the
 * vitest config's documented pattern for page-level component tests).
 */

import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OrdersPage from "@/pages/orders";
import OrderDetailPage from "@/pages/order-detail";
import { useGetOrder, useListOrders } from "@workspace/api-client-react";

vi.mock("@workspace/api-client-react", () => ({
  useListOrders: vi.fn(),
  getListOrdersQueryKey: () => ["/api/orders"],
  useGetOrder: vi.fn(),
  getGetOrderQueryKey: (code: string) => [`/api/orders/${code}`],
  // R104: order-detail rides the shared /api/auth/me cache for its
  // page-scoped socket identity.
  useGetMe: vi.fn(() => ({ data: { id: 7 } })),
  getGetMeQueryKey: () => ["/api/auth/me"],
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

const toastSpy = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastSpy }),
  // use-socket imports the bare `toast` from the same shim.
  toast: toastSpy,
}));

/** A refunded order modeled on the backend formatOrder shape. amount
 * 160.00 mirrors a real refunded order from the live reconciliation. */
const REFUNDED_ORDER = {
  id: 41,
  order_code: "SNDB41REF",
  product_id: 3,
  product_name: "Netflix شهر",
  product_image_url: null,
  variant_id: null,
  status: "refunded",
  amount: 160,
  created_at: "2026-09-01T12:00:00.000Z",
  delivered_email: null,
  delivered_password: null,
  delivered_extra_details: null,
  delivered_usage_terms: null,
  discount_amount: 0,
  coupon_code: null,
};

beforeEach(() => {
  vi.mocked(useListOrders).mockReset();
  vi.mocked(useGetOrder).mockReset();
  toastSpy.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** R120-B7: orders.tsx fetches /api/orders?page=N directly — the
 * orders-load-more.test.tsx fetch-mock idiom. */
const jsonRes = (body: unknown, ok = true, status = 200) =>
  ({ ok, status, json: async () => body }) as Response;
const fetchMock = vi.fn<typeof fetch>();

describe("OrdersPage — a refunded row is calm info, not failure (R115-I1 / A8 P2-3)", () => {
  it("shows the undo glyph + info accent + the refund receipt chip with the AMOUNT", async () => {
    // R120-B7: orders.tsx rides useInfiniteQuery over the raw
    // /api/orders?page=N URL (the ?page= consumption) — mock the global
    // fetch like orders-load-more.test.tsx does, no generated hook.
    fetchMock.mockImplementation(async () => jsonRes([REFUNDED_ORDER]));

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <Router>
          <OrdersPage />
        </Router>
      </QueryClientProvider>,
    );

    // The row (scoped from the order code so the filter chips' own
    // XCircle icon — the failed bucket — doesn't pollute the assertion).
    // R120-B7: real QueryClient → the first page resolves async.
    const codeEl = await screen.findByText("SNDB41REF");
    const row = codeEl.closest("a") as HTMLElement;
    expect(row).not.toBeNull();
    const card = row.querySelector("div.bg-card") as HTMLElement;
    expect(card).not.toBeNull();

    // Calm info tone: the row's accent is status-info…
    expect(card.className).toContain("border-r-status-info/55");
    expect(card.className).not.toContain("border-r-status-error/55");
    // …the pill still reads the shared statusLabel…
    expect(card.textContent).toContain("مُسترد");
    // …and the icon is the undo glyph — the failure XCircle must not
    // appear anywhere INSIDE the refunded row.
    expect(card.querySelector("svg.lucide-undo-2")).not.toBeNull();
    expect(card.querySelector("svg.lucide-x-circle")).toBeNull();

    // The refund receipt on the row: the refunded AMOUNT (orders.amount
    // — the full figure RefundService credits back to the wallet).
    expect(card.textContent).toContain("استُرد 160.00 د.ل إلى محفظتك");
  });
});

describe("OrderDetailPage — the refund card is an honest receipt (R115-I1 / A8 P2-3)", () => {
  function renderDetail() {
    vi.mocked(useGetOrder).mockReturnValue({
      data: REFUNDED_ORDER,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useGetOrder>);

    window.history.pushState({}, "", `/orders/${REFUNDED_ORDER.order_code}`);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return render(
      <QueryClientProvider client={queryClient}>
        <Router>
          <OrderDetailPage />
        </Router>
      </QueryClientProvider>,
    );
  }

  it("calm info tone: the header bar + refund card ride status-info, not status-error", () => {
    const { container } = renderDetail();

    expect(screen.getByText("تم الاسترداد")).toBeInTheDocument();
    expect(screen.queryByText("فشل الطلب")).not.toBeInTheDocument();

    // The top color bar carries the info gradient…
    expect(container.querySelector('[class*="from-status-info"]')).not.toBeNull();
    expect(container.querySelector('[class*="from-status-error"]')).toBeNull();
    // …and the refund card's border is info-toned…
    expect(container.querySelector('[class*="border-status-info"]')).not.toBeNull();
    // …with the undo glyph (no XCircle anywhere on a refunded order).
    expect(container.querySelector("svg.lucide-undo-2")).not.toBeNull();
    expect(container.querySelector("svg.lucide-x-circle")).toBeNull();
  });

  it("the receipt names the refunded AMOUNT («استُرد X د.ل إلى محفظتك»)", () => {
    renderDetail();

    expect(screen.getByText("استُرد 160.00 د.ل إلى محفظتك تلقائياً")).toBeInTheDocument();
    // The header's amount row shows the same figure (tabular-nums,
    // Western digits, «د.ل» suffix — the money conventions).
    expect(screen.getByText("160.00 د.ل")).toBeInTheDocument();
  });

  it("discloses the loyalty-points reversal honestly («خُصمت نقاط الشراء المستردة»)", () => {
    renderDetail();

    expect(screen.getByText(/خُصمت نقاط الشراء المستردة/)).toBeInTheDocument();
  });
});
