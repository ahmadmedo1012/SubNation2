/**
 * R115 (A8 P2) — the wallet STATEMENT rendering tests.
 *
 * GET /api/wallet/ledger gave the wallet page its missing money list:
 * until R115 the page showed only topup REQUESTS — refunds, loyalty
 * conversions, admin adjustments and referral/welcome credits were
 * invisible as transactions (a user could not reconcile their balance).
 * These tests pin the statement card's four states and its display
 * contract:
 *
 *   1. ROWS: type_label + SIGNED/directional amount (credits «+», the
 *      purchase debit «-», adjustments carry their own sign) +
 *      balance_after + date, tabular amounts in a dir="ltr" span.
 *   2. EMPTY: «لا توجد حركات بعد» — never shown for an outage.
 *   3. LOADING: skeleton — heading present, no rows, no empty state.
 *   4. ERROR: a distinct error card + retry (93-C5 / F-05: outage ≠
 *      empty), wired to the hook's refetch.
 *   5. The hook is called with the session's Authorization header and a
 *      queryKey from getGetWalletLedgerQueryKey (cache-contract pin).
 *
 * `@workspace/api-client-react` + `@/lib/auth` are mocked at the module
 * boundary (the wallet page's documented test pattern); only
 * useGetWalletLedger gains per-test data here.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { beforeEach, describe, expect, it, vi } from "vitest";
import WalletPage from "@/pages/wallet";
import { useGetWalletLedger } from "@workspace/api-client-react";
import { formatDate } from "@/lib/utils";

const mutateMock = vi.fn();

vi.mock("@workspace/api-client-react", () => ({
  getGetWalletQueryKey: () => ["/api/wallet"],
  getListTopupsQueryKey: () => ["/api/wallet/topups"],
  getGetWalletLedgerQueryKey: () => ["/api/wallet/ledger"],
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
  useGetWalletLedger: vi.fn(() => ({
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
  useAuth: () => ({ token: "test token" }),
}));

type LedgerResult = ReturnType<typeof useGetWalletLedger>;

function mockLedger(over: Partial<LedgerResult>) {
  vi.mocked(useGetWalletLedger).mockReturnValue({
    data: [],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    ...over,
  } as unknown as LedgerResult);
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

/** A ledger row in the exact GET /wallet/ledger DTO shape. */
function ledgerRow(over: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 1,
    type: "topup",
    type_label: "شحن محفظة",
    amount: 50,
    balance_after: 50,
    reference_type: "wallet_topup",
    description: null,
    created_at: new Date("2026-09-29T10:00:00Z").toISOString(),
    ...over,
  };
}

beforeEach(() => {
  mutateMock.mockReset();
  mockLedger({});
  localStorage.clear();
  sessionStorage.clear();
});

describe("WalletPage — the wallet STATEMENT (R115, A8 P2)", () => {
  it("renders ledger rows: labels, signed directional amounts, balance_after, date", () => {
    mockLedger({
      data: [
        ledgerRow({
          id: 4,
          type: "purchase",
          type_label: "شراء",
          amount: 80,
          balance_after: 70,
        }),
        ledgerRow({
          id: 3,
          type: "refund",
          type_label: "استرداد",
          amount: 80,
          balance_after: 150,
        }),
        ledgerRow({
          id: 2,
          type: "adjustment",
          type_label: "تسوية رصيد",
          amount: -20,
          balance_after: 70,
        }),
        ledgerRow({ id: 1 }),
      ] as never,
    });

    renderPage();

    // The Arabic labels from the API (LEDGER_TYPE_LABELS server-side).
    expect(screen.getByText("شحن محفظة")).toBeInTheDocument();
    expect(screen.getByText("شراء")).toBeInTheDocument();
    expect(screen.getByText("استرداد")).toBeInTheDocument();
    expect(screen.getByText("تسوية رصيد")).toBeInTheDocument();

    // Signed, directional amounts: topup/refund credits «+», the
    // purchase debit «-», the adjustment keeps its own sign.
    expect(screen.getByText("+50.00 د.ل")).toBeInTheDocument();
    expect(screen.getByText("+80.00 د.ل")).toBeInTheDocument();
    expect(screen.getByText("-80.00 د.ل")).toBeInTheDocument();
    expect(screen.getByText("-20.00 د.ل")).toBeInTheDocument();

    // balance_after rendered per row.
    expect(screen.getAllByText(/الرصيد بعدها:/).length).toBe(4);

    // The date column uses the shared formatter on created_at.
    expect(
      screen.getAllByText(`· ${formatDate(new Date("2026-09-29T10:00:00Z").toISOString())}`).length,
    ).toBe(4);

    // The empty state must NOT be present alongside rows.
    expect(screen.queryByText("لا توجد حركات بعد")).not.toBeInTheDocument();
  });

  it("empty ledger renders the «لا توجد حركات بعد» empty state, not an error", () => {
    mockLedger({ data: [] });
    renderPage();

    expect(screen.getByText("لا توجد حركات بعد")).toBeInTheDocument();
    expect(screen.queryByText("تعذّر تحميل سجل الحركات")).not.toBeInTheDocument();
  });

  it("loading renders the heading with skeleton rows — no empty state flash", () => {
    mockLedger({ data: undefined, isLoading: true });
    renderPage();

    expect(screen.getByText("سجل الحركات")).toBeInTheDocument();
    // Neither the empty state nor an error may render while loading —
    // the old "no topups yet" flash was the 93-C5/F-05 bug class.
    expect(screen.queryByText("لا توجد حركات بعد")).not.toBeInTheDocument();
    expect(screen.queryByText("تعذّر تحميل سجل الحركات")).not.toBeInTheDocument();
  });

  it("a failed ledger fetch is an ERROR card with retry (outage ≠ empty)", async () => {
    const refetch = vi.fn();
    mockLedger({ data: undefined, isError: true, refetch });
    renderPage();

    expect(screen.getByText("تعذّر تحميل سجل الحركات")).toBeInTheDocument();
    // Not the empty state — the outage must not read as "no movements".
    expect(screen.queryByText("لا توجد حركات بعد")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    await waitFor(() => expect(refetch).toHaveBeenCalled());
  });

  it("subscribes with the session Authorization header and the generated ledger queryKey", () => {
    renderPage();

    expect(vi.mocked(useGetWalletLedger)).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({
        query: expect.objectContaining({
          queryKey: ["/api/wallet/ledger"],
          enabled: true,
        }),
        request: expect.objectContaining({
          headers: expect.objectContaining({ Authorization: "Bearer test token" }),
        }),
      }),
    );
  });
});
