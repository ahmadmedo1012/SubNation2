/**
 * R126-L6 (A9-3) — wallet topup method tab ↔ ?method= URL mirror.
 *
 * The method tab was local state reset by the mount-time prefs loader on
 * every mount: a lypay user who reloaded mid-form was silently reset to
 * the mobile-transfer tab (R124 deep-link work covered ?return= but not
 * the tab). The home/admin ?tab= idiom (R98-04) now applies: whitelisted
 * mount read + replaceState mirror (no history spam), with the URL seed
 * outranking the stored preference (an explicit link is the stronger
 * intent) and ?return= preserved on every rewrite.
 *
 * Pinned here:
 *   • mount at /wallet?method=lypay ⇒ the LyPay tab is pressed — even
 *     when a stored prefs entry says mobile_transfer (the clobber bug);
 *   • switching to the default tab strips ?method= while PRESERVING
 *     other params (?return=…);
 *   • a bogus ?method= value falls back to the default tab.
 *
 * Harness: the wallet-submit.test.tsx pattern — the api-client mocked at
 * the module boundary.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WalletPage from "@/pages/wallet";

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

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  window.history.pushState(null, "", "/wallet");
});

afterEach(() => {
  window.history.pushState(null, "", "/wallet");
});

describe("WalletPage — topup method tab ↔ ?method= URL (A9-3, R126-L6)", () => {
  it("mounts at ?method=lypay with the LyPay tab pressed — even against a stored mobile_transfer preference", async () => {
    // The pre-fix clobber: the mount-time prefs loader called
    // setMethod(prefs.method) unconditionally, so a stored preference
    // silently overrode the URL's explicit choice.
    localStorage.setItem(
      "subnation_topup_preferences",
      JSON.stringify({ network: "libyana", amount: "", method: "mobile_transfer" }),
    );
    window.history.pushState(null, "", "/wallet?method=lypay");
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("تحويل مصرفي").closest("button")).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });
    expect(screen.getByText("تحويل رصيد").closest("button")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("switching back to the default tab strips ?method= while PRESERVING ?return=", async () => {
    window.history.pushState(null, "", "/wallet?method=lypay&return=%2Fproduct%2Fx");
    renderPage();

    const mobileTab = await waitFor(() => {
      const btn = screen.getByText("تحويل رصيد").closest("button");
      expect(btn).toBeTruthy();
      return btn as HTMLElement;
    });
    fireEvent.click(mobileTab);

    await waitFor(() => {
      // The mirror effect owns ONLY the method key: the deep-link
      // ?return= param (the product→wallet round-trip) survives.
      expect(window.location.search).toBe("?return=%2Fproduct%2Fx");
    });
    expect(screen.getByText("تحويل رصيد").closest("button")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("a bogus ?method= value falls back to the default tab (whitelisted read)", async () => {
    window.history.pushState(null, "", "/wallet?method=telepathy");
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("تحويل رصيد").closest("button")).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });
    // The whitelisted state owns the URL — the bogus value is stripped
    // by the default-tab mirror.
    await waitFor(() => {
      expect(window.location.search).toBe("");
    });
  });
});
