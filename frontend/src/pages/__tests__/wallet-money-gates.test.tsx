/**
 * R111-FIX-T / T2 — the wallet MONEY GATES of wallet.tsx.
 *
 * The existing wallet-submit.test.tsx harness pins the payload contract,
 * the sanitizer, the a11y labels and the Idempotency-Key rotation — but its
 * static `useListTopups` mock always returns `data: []`, which makes the
 * page's pending-topup gate DEAD CODE under test. Unpinned until now:
 *
 *   1. MAX_PENDING=3 — three pending topups must block the submit
 *      affordance (banner + inert form card + handleSubmit guard).
 *   2. The 10,000 LYD cap (10000.01 → client-side rejection, no request).
 *   3. The 0.01 floor (0.009 → client-side rejection, no request).
 *   4. The 0.5-dinar snap — Math.min(10000, Math.max(1, round(v*2)/2)):
 *      1.3 → 1.5, 1.2 → 1, and (reality pin) 0.01 itself is NOT sent as
 *      0.01 — the snap's Math.max(1, …) clamps the SUBMITTED amount to a
 *      1 LYD floor even though the rejection message quotes 0.01.
 *
 * Boundary notes (read off the validators in wallet.tsx handleSubmit):
 *   - the rejection tests drive fireEvent.submit deliberately: a blur
 *     first would let the input's onBlur rounding coerce the value (the
 *     same reason wallet-submit.test.tsx uses fireEvent.submit).
 *   - the backend pins its own side (0.01/10000 accepted at the route);
 *     these tests pin the FRONTEND's stricter/snap behavior.
 *
 * `@workspace/api-client-react` and `@/lib/auth` are mocked at the module
 * boundary (the vitest config's documented pattern for page-level tests);
 * only useListTopups gains per-test data here.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { beforeEach, describe, expect, it, vi } from "vitest";
import WalletPage from "@/pages/wallet";
import { useCreateTopup, useGetWallet, useListTopups } from "@workspace/api-client-react";

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
  // R115: the wallet statement hook (GET /api/wallet/ledger) — empty
  // + healthy by default; the statement's own states are pinned in
  // wallet-statement.test.tsx.
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

type WalletResult = ReturnType<typeof useGetWallet>;
type TopupsResult = ReturnType<typeof useListTopups>;

/** A pending topup row in the shape useListTopups returns. */
function pendingTopup(id: number, minutesAgo = 5): Record<string, unknown> {
  return {
    id,
    status: "pending",
    amount: 25,
    payment_method: "mobile_transfer",
    payment_network: "libyana",
    created_at: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
  };
}

function mockTopups(rows: Array<Record<string, unknown>>) {
  vi.mocked(useListTopups).mockReturnValue({
    data: rows as never,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  } as unknown as TopupsResult);
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

function amountField(): HTMLInputElement {
  return screen.getByLabelText("المبلغ بالدينار الليبي") as HTMLInputElement;
}

function fillValidForm(amount: string) {
  fireEvent.change(amountField(), { target: { value: amount } });
  fireEvent.change(screen.getByLabelText("رقم هاتف المُرسل"), {
    target: { value: "0912345678" },
  });
}

async function submitFromForm() {
  // fireEvent.submit bypasses jsdom constraint validation AND the amount
  // input's onBlur re-rounding — exactly like wallet-submit.test.tsx, so
  // the boundary values below reach handleSubmit's own guards uncoerced.
  const form = document.querySelector("form")!;
  expect(form).not.toBeNull();
  fireEvent.submit(form);
}

async function clickSubmit() {
  fireEvent.click(screen.getByRole("button", { name: "إرسال طلب الشحن" }));
}

beforeEach(() => {
  mutateMock.mockReset();
  vi.mocked(useGetWallet).mockReturnValue({
    data: { balance: 150, loyalty_points: 0, loyalty_tier: "bronze" },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  } as unknown as WalletResult);
  vi.mocked(useListTopups).mockReturnValue({
    data: [],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  } as unknown as TopupsResult);
  localStorage.clear();
  sessionStorage.clear();
});

describe("WalletPage — MAX_PENDING=3 gate (T2: dead under the static data:[] mock)", () => {
  it("three pending topups block the submit affordance: banner + inert form card + guard, and NO request", async () => {
    mockTopups([pendingTopup(11, 40), pendingTopup(12, 20), pendingTopup(13, 5)]);
    const { container } = renderPage();

    // The persistent warning banner…
    expect(await screen.findByText("طلبات الشحن موقوفة مؤقتاً")).toBeInTheDocument();
    // …with the live count and the cap.
    expect(screen.getByText(/قيد المراجعة/)).toBeInTheDocument();

    // The form card itself goes inert (opacity-50 + pointer-events-none).
    const form = container.querySelector("form")!;
    expect(form).not.toBeNull();
    expect(form.closest("[class*='pointer-events-none']")).not.toBeNull();

    // And even a stray Enter (fireEvent.submit bypasses pointer-events)
    // hits handleSubmit's own pendingBlocked guard — no request leaves.
    fireEvent.submit(form);
    expect(
      await screen.findByText("لديك طلبات قيد المراجعة، يرجى الانتظار حتى تُعتمد"),
    ).toBeInTheDocument();
    expect(mutateMock).not.toHaveBeenCalled();
  });

  it("two pending topups still submit — the cap is 3, not 2 (boundary)", async () => {
    mockTopups([pendingTopup(21, 15), pendingTopup(22, 5)]);
    renderPage();

    // The live "2/3 معلق" chip, not the blocked banner.
    expect(await screen.findByText("2/3 معلق")).toBeInTheDocument();
    expect(screen.queryByText("طلبات الشحن موقوفة مؤقتاً")).not.toBeInTheDocument();

    fillValidForm("50");
    await clickSubmit();

    await waitFor(() => {
      expect(mutateMock).toHaveBeenCalledTimes(1);
    });
    expect(mutateMock.mock.calls[0][0].data).toMatchObject({ amount: 50 });
  });
});

describe("WalletPage — amount money gates (handleSubmit validators)", () => {
  it("0.009 LYD is rejected client-side with the 0.01 floor message — no request", async () => {
    renderPage();

    fireEvent.change(amountField(), { target: { value: "0.009" } });
    await submitFromForm();

    expect(await screen.findByText("أقل مبلغ شحن هو 0.01 د.ل")).toBeInTheDocument();
    expect(mutateMock).not.toHaveBeenCalled();
  });

  it("10,000.01 LYD is rejected client-side with the cap message — no request", async () => {
    renderPage();

    fireEvent.change(amountField(), { target: { value: "10000.01" } });
    await submitFromForm();

    expect(await screen.findByText("الحد الأقصى للشحن هو 10,000 د.ل")).toBeInTheDocument();
    expect(mutateMock).not.toHaveBeenCalled();
  });

  it("10,000 LYD exactly passes the cap — the full amount is submitted", async () => {
    renderPage();

    fillValidForm("10000");
    await clickSubmit();

    await waitFor(() => {
      expect(mutateMock).toHaveBeenCalledTimes(1);
    });
    expect(mutateMock.mock.calls[0][0].data).toMatchObject({ amount: 10000 });
  });
});

describe("WalletPage — the 0.5-dinar snap (Math.min(10000, Math.max(1, round(v*2)/2)))", () => {
  it("1.3 snaps UP to 1.5 — the submitted payload AND the field both carry 1.5", async () => {
    renderPage();

    fillValidForm("1.3");
    await clickSubmit();

    await waitFor(() => {
      expect(mutateMock).toHaveBeenCalledTimes(1);
    });
    expect(mutateMock.mock.calls[0][0].data).toMatchObject({ amount: 1.5 });
    // The normalized value is written back into the field.
    expect(amountField().value).toBe("1.5");
  });

  it("1.2 snaps DOWN to 1 (nearest 0.5, not ceiling)", async () => {
    renderPage();

    fillValidForm("1.2");
    await clickSubmit();

    await waitFor(() => {
      expect(mutateMock).toHaveBeenCalledTimes(1);
    });
    expect(mutateMock.mock.calls[0][0].data).toMatchObject({ amount: 1 });
  });

  it("REALITY PIN: 0.01 passes the floor check but the snap's Math.max(1, …) submits it as 1 LYD", async () => {
    // The floor message quotes 0.01, yet no sub-0.75 amount can ever be
    // SENT: the normalizer clamps to a 1 LYD minimum. The backend would
    // accept 0.01 (its own boundary pins do) — the frontend never offers
    // it. Pinned so a future change to either side is a conscious one.
    renderPage();

    fillValidForm("0.01");
    await clickSubmit();

    await waitFor(() => {
      expect(mutateMock).toHaveBeenCalledTimes(1);
    });
    expect(mutateMock.mock.calls[0][0].data).toMatchObject({ amount: 1 });
    expect(amountField().value).toBe("1");
  });
});
