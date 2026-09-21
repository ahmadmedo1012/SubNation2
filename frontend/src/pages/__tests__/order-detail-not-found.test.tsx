/**
 * 404 vs connection-error distinction on the order-detail page
 * (R94-A1 #4).
 *
 * The backend answers every unknown / foreign / stale order code with
 * 404 ORDER_NOT_FOUND (routes/orders.ts:242). The page used to render
 * the «خطأ اتصال» card for it — a diagnosis that sends the user into
 * an infinite retry loop that can never succeed (the retry re-404s).
 * product.tsx already splits the same ApiError.status; order-detail
 * now does too: 404 → «الطلب غير موجود» (no retry button), anything
 * else → connection error (with retry).
 *
 * `@workspace/api-client-react` is mocked at the module boundary with
 * an error object carrying `status` — the shape customFetch's ApiError
 * exposes on every non-2xx.
 */

import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OrderDetailPage from "@/pages/order-detail";
import { useGetOrder } from "@workspace/api-client-react";

vi.mock("@workspace/api-client-react", () => ({
  useGetOrder: vi.fn(),
  getGetOrderQueryKey: (code: string) => [`/api/orders/${code}`],
  // R104: order-detail now also rides the shared /api/auth/me cache for
  // its page-scoped socket identity.
  useGetMe: vi.fn(() => ({ data: { id: 1 } })),
  getGetMeQueryKey: () => ["/api/auth/me"],
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

const toastSpy = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastSpy }),
}));

type GetOrderResult = ReturnType<typeof useGetOrder>;

function mockGetOrderError(error: unknown) {
  vi.mocked(useGetOrder).mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: true,
    error,
    refetch: vi.fn(),
  } as unknown as GetOrderResult);
}

function renderPage(orderCode: string) {
  // wouter reads the real (jsdom) location — set the route param path
  // before mounting so useParams resolves the order code.
  window.history.pushState({}, "", `/orders/${orderCode}`);
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

describe("OrderDetailPage — 404 is «الطلب غير موجود», never «خطأ اتصال» (R94-A1 #4)", () => {
  beforeEach(() => {
    toastSpy.mockReset();
    vi.mocked(useGetOrder).mockReset();
  });

  it("a 404 error renders the not-found card WITHOUT a retry button", () => {
    mockGetOrderError({ name: "ApiError", status: 404, message: "الطلب غير موجود" });

    renderPage("SNDBDOESNOTEXIST");

    expect(screen.getByText("الطلب غير موجود")).toBeInTheDocument();
    expect(screen.getByText("تأكد من رقم الطلب أو عُد لقائمة طلباتك")).toBeInTheDocument();
    // Crucially NOT the connection-error diagnosis…
    expect(screen.queryByText("تعذّر تحميل الطلب")).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        "حدث خطأ في الاتصال — تحقّق من اتصالك ثم أعد المحاولة. إن استمرت المشكلة تواصل مع الدعم.",
      ),
    ).not.toBeInTheDocument();
    // …and no infinite-retry button for an order that will 404 again.
    expect(screen.queryByRole("button", { name: /إعادة المحاولة/ })).not.toBeInTheDocument();
    // The escape hatch back to the orders list is present instead.
    expect(screen.getByRole("button", { name: /العودة للطلبات/ })).toBeInTheDocument();
  });

  it("a network/5xx error KEEPS the connection-error card with retry", () => {
    mockGetOrderError({ name: "TypeError", message: "failed to fetch" });

    renderPage("SNDB1851DE");

    expect(screen.getByText("تعذّر تحميل الطلب")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /إعادة المحاولة/ })).toBeInTheDocument();
    expect(screen.queryByText("الطلب غير موجود")).not.toBeInTheDocument();
  });

  it("a 5xx ApiError (status 500) also keeps the retry card", () => {
    mockGetOrderError({ name: "ApiError", status: 500, message: "internal" });

    renderPage("SNDB1851DE");

    expect(screen.getByText("تعذّر تحميل الطلب")).toBeInTheDocument();
    expect(screen.queryByText("تأكد من رقم الطلب أو عُد لقائمة طلباتك")).not.toBeInTheDocument();
  });
});
