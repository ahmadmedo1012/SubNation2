/**
 * Wallet topup form tests — 93-C5 / F-03 (A10 spec (b)).
 *
 * The topup form never sent `payment_reference`, which left the backend's
 * entire duplicate-transfer dedup machinery (advisory lock + in-tx
 * reference check + partial unique index, V1-M9/B2-02) conditional on a
 * field that was always empty — a user could submit the same real
 * transfer 3× (MAX_PENDING) and be credited 3×. These tests pin:
 *
 *   1. A reference the user typed is TRIMMED and sent in the POST body
 *      (asserted on the orval mutation's `mutate({ data })` payload —
 *      A10's spec phrases it as the fetch body; the implementation goes
 *      through useCreateTopup, so the payload is the outgoing contract).
 *   2. Client-side rejection of an invalid amount performs no request.
 *   3. A failed /api/wallet probe renders an error state, NOT a
 *      fabricated 0.00-balance card (A10 spec (e), A4 P2 #7).
 *
 * `@workspace/api-client-react` and `@/lib/auth` are mocked at the
 * module boundary (the vitest config's documented pattern for
 * page-level component tests).
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { beforeEach, describe, expect, it, vi } from "vitest";
import WalletPage from "@/pages/wallet";
import { useGetWallet } from "@workspace/api-client-react";

const mutateMock = vi.fn();

vi.mock("@workspace/api-client-react", () => ({
  getGetWalletQueryKey: () => ["/api/wallet"],
  getListTopupsQueryKey: () => ["/api/wallet/topups"],
  useGetWallet: vi.fn(() => ({
    data: { balance: 150, loyalty_points: 0, loyalty_tier: "bronze" },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  })),
  useListTopups: vi.fn(() => ({
    data: [],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  })),
  useCreateTopup: vi.fn(() => ({
    mutate: mutateMock,
    isPending: false,
    reset: vi.fn(),
  })),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

type WalletResult = ReturnType<typeof useGetWallet>;

function mockWalletResult(over: Partial<WalletResult>) {
  vi.mocked(useGetWallet).mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    ...over,
  } as unknown as WalletResult);
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Router>
        <WalletPage />
      </Router>
    </QueryClientProvider>,
  );
}

describe("WalletPage topup form — payment_reference reaches the server (93-C5 F-03)", () => {
  beforeEach(() => {
    mutateMock.mockReset();
    // Deterministic default for the balance query (tests that need the
    // error branch override it explicitly below).
    vi.mocked(useGetWallet).mockReturnValue({
      data: { balance: 150, loyalty_points: 0, loyalty_tier: "bronze" },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as WalletResult);
    localStorage.clear();
    sessionStorage.clear();
  });

  it("sends the trimmed payment_reference in the topup POST body", async () => {
    renderPage();

    // Amount (step 2 of the mobile-transfer flow).
    fireEvent.change(screen.getByPlaceholderText("أو أدخل مبلغاً آخر..."), {
      target: { value: "50" },
    });
    // Sender phone (step 4) — 10-digit Libyan format.
    fireEvent.change(screen.getByPlaceholderText("091XXXXXXX"), {
      target: { value: "0912345678" },
    });
    // The receipt reference field (93-C5 / F-03) — typed with padding to
    // prove the trim-at-submit boundary.
    fireEvent.change(screen.getByLabelText("رقم مرجع التحويل (اختياري)"), {
      target: { value: "  TRX-9  " },
    });

    fireEvent.click(screen.getByRole("button", { name: "إرسال طلب الشحن" }));

    await waitFor(() => {
      expect(mutateMock).toHaveBeenCalledTimes(1);
    });
    expect(mutateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        amount: 50,
        payment_method: "mobile_transfer",
        payment_reference: "TRX-9",
        sender_phone: "0912345678",
      }),
    });
  });

  it("omits payment_reference when the user left it blank (optional field)", async () => {
    renderPage();

    fireEvent.change(screen.getByPlaceholderText("أو أدخل مبلغاً آخر..."), {
      target: { value: "50" },
    });
    fireEvent.change(screen.getByPlaceholderText("091XXXXXXX"), {
      target: { value: "0912345678" },
    });

    fireEvent.click(screen.getByRole("button", { name: "إرسال طلب الشحن" }));

    await waitFor(() => {
      expect(mutateMock).toHaveBeenCalledTimes(1);
    });
    const body = mutateMock.mock.calls[0][0].data as Record<string, unknown>;
    expect(body.payment_reference).toBeUndefined();
  });

  it("rejects an invalid amount client-side without any request", async () => {
    const { container } = renderPage();

    // fireEvent.submit bypasses jsdom's constraint validation (the empty
    // amount input is `required`) AND the input's onBlur re-rounding
    // (which would coerce a typed 0 to 1) — this exercises handleSubmit's
    // OWN guard: a non-positive amount never reaches the network.
    fireEvent.change(screen.getByPlaceholderText("أو أدخل مبلغاً آخر..."), {
      target: { value: "0" },
    });
    fireEvent.submit(container.querySelector("form")!);

    await waitFor(() => {
      expect(screen.getByText("يرجى إدخال مبلغ صالح")).toBeInTheDocument();
    });
    expect(mutateMock).not.toHaveBeenCalled();
  });

  it("renders an error state (not a fabricated balance) when /api/wallet fails", async () => {
    mockWalletResult({ isError: true });

    renderPage();

    // 93-C5 / F-05 (A4 #7): the balance card used to silently vanish on a
    // failed probe; now it's an explicit, retryable error card.
    expect(await screen.findByText("تعذّر تحميل رصيد المحفظة")).toBeInTheDocument();
    expect(screen.queryByText("الرصيد المتاح")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "إعادة المحاولة" })).toBeInTheDocument();
  });
});
