/**
 * L1-2 (R143) — the topup→checkout return affordance on /wallet.
 *
 * The ONLY path from a failed checkout to topup stashes
 * `/wallet?return=/checkout` in sessionStorage (PaymentMethodCard's
 * «اشحن المحفظة ثم عُد لإتمام الطلب» link → wallet.tsx's mount stash),
 * but the sole consumer was TopupWaitingModal's onApprovedContinue —
 * armed exclusively by a NEW submit's `setWaitingTopupId`. An approval
 * landing after the modal was dismissed (10 s agency), after
 * navigation, or after tab-death dead-ended the journey: nothing on
 * /wallet offered the way back to the still-pending cart, while the
 * un-consumed intent survived indefinitely (until some future,
 * unrelated topup's modal fired it onto a possibly-stale basket).
 *
 * Pinned here:
 *   1. stashed intent + latest topup APPROVED + no open modal ⇒ the
 *      «متابعة الشراء» affordance renders;
 *   2. clicking it navigates to the stashed target AND consumes the
 *      sessionStorage entry (consume-or-clear);
 *   3. «إخفاء» consumes the entry without navigating (the stale-intent
 *      window closes);
 *   4. a PENDING latest topup (approval not yet landed) renders NO
 *      affordance — the money hasn't moved, «متابعة الشراء» would lie;
 *   5. no stashed intent ⇒ no banner (an approved topup alone must not
 *      sprout a checkout affordance).
 *
 * Harness: wallet-method-url.test.tsx's pattern — the api-client mocked
 * at the module boundary with a per-test controllable useListTopups.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WalletPage from "@/pages/wallet";
import { useListTopups } from "@workspace/api-client-react";

vi.mock("@workspace/api-client-react", () => ({
  getGetWalletQueryKey: () => ["/api/wallet"],
  getListTopupsQueryKey: () => ["/api/wallet/topups"],
  getGetWalletLedgerQueryKey: () => ["/api/wallet/ledger"],
  getGetMeQueryKey: () => ["/api/auth/me"],
  useGetMe: vi.fn(() => ({
    data: { id: 7, wallet_balance: 150 },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  })),
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
    mutate: vi.fn(),
    isPending: false,
    reset: vi.fn(),
  })),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

function mockTopups(rows: Array<{ id: number; status: string; created_at?: string }>) {
  vi.mocked(useListTopups).mockReturnValue({
    data: rows.map((r) => ({
      id: r.id,
      status: r.status,
      amount: 50,
      created_at: r.created_at ?? "2026-10-14T10:00:00.000Z",
      payment_network: "madar",
    })),
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useListTopups>);
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

const AFFORDANCE = "متابعة الشراء";

describe("WalletPage — the checkout-return affordance (L1-2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    window.history.pushState(null, "", "/wallet");
  });

  afterEach(() => {
    window.history.pushState(null, "", "/wallet");
  });

  it("stashed intent + APPROVED latest topup + no modal ⇒ the affordance renders and navigates on click (intent consumed)", async () => {
    // The checkout-insufficient journey: /wallet?return=/checkout stashed
    // the intent; the operator approved the topup after the buyer left
    // (modal dismissed / navigated away).
    window.history.pushState(null, "", "/wallet?return=%2Fcheckout");
    mockTopups([{ id: 9, status: "approved" }]);

    renderPage();

    expect(await screen.findByRole("button", { name: AFFORDANCE })).toBeInTheDocument();
    expect(screen.getByText(/تم اعتماد طلب الشحن — يمكنك متابعة عملية الشراء/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: AFFORDANCE }));

    // The way back to the still-pending cart…
    await waitFor(() => expect(window.location.pathname).toBe("/checkout"));
    // …and the intent is CONSUMED (never fires on a future topup's modal).
    expect(sessionStorage.getItem("subnation_topup_return")).toBeNull();
  });

  it("«إخفاء» consumes the intent without navigating (the stale-intent window closes)", async () => {
    window.history.pushState(null, "", "/wallet?return=%2Fcheckout");
    mockTopups([{ id: 9, status: "approved" }]);

    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "إخفاء" }));

    expect(sessionStorage.getItem("subnation_topup_return")).toBeNull();
    expect(window.location.pathname).toBe("/wallet");
    // The banner is gone (the intent no longer arms it).
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: AFFORDANCE })).not.toBeInTheDocument(),
    );
  });

  it("a PENDING latest topup renders NO affordance — the money has not moved yet", () => {
    window.history.pushState(null, "", "/wallet?return=%2Fcheckout");
    mockTopups([{ id: 9, status: "pending" }]);

    renderPage();

    expect(screen.queryByRole("button", { name: AFFORDANCE })).not.toBeInTheDocument();
    // …and the intent is NOT consumed by the render (the approval may
    // still land and arm it).
    expect(sessionStorage.getItem("subnation_topup_return")).toBe("/checkout");
  });

  it("no stashed intent ⇒ no banner (an approved topup alone is not a checkout intent)", () => {
    mockTopups([{ id: 9, status: "approved" }]);

    renderPage();

    expect(screen.queryByRole("button", { name: AFFORDANCE })).not.toBeInTheDocument();
  });
});
