/**
 * TopupWaitingModal aria semantics — 96-F6 (R96 A6 #3 P1).
 *
 * The approved/rejected decision used to swap inside the Dialog with NO
 * live region: the only aria-live element (the waiting countdown) was
 * UNMOUNTED by the swap, so a screen-reader user heard "3… 2… 1" and
 * then silence at the single most important money moment of the app.
 *
 * These tests pin the fix:
 *   - ApprovedBody root  → role="status"  + aria-live="polite"
 *   - RejectedBody root  → role="alert"   (assertive)
 *   - the waiting countdown's own aria-live region stays as-is.
 *
 * `@workspace/api-client-react` is mocked at the module boundary (the
 * vitest config's documented pattern for component tests) — the modal's
 * status is driven by the mocked topups list.
 */

import { act, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TopupWaitingModal } from "@/components/TopupWaitingModal";
import { useListTopups } from "@workspace/api-client-react";

interface MockTopup {
  id: number;
  status: string;
  amount: number;
  admin_note?: string | null;
  created_at: string;
  payment_network?: string;
}

const listTopupsMock = vi.fn();

vi.mock("@workspace/api-client-react", () => ({
  getListTopupsQueryKey: () => ["/api/wallet/topups"],
  getGetWalletQueryKey: () => ["/api/wallet"],
  useListTopups: () => listTopupsMock(),
  useGetWallet: () => ({
    data: { balance: 150, loyalty_points: 0, loyalty_tier: "bronze" },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

function renderModal(topup: MockTopup) {
  listTopupsMock.mockReturnValue({ data: [topup] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TopupWaitingModal topupId={topup.id} token="test-token" onClose={vi.fn()} />
    </QueryClientProvider>,
  );
}

const BASE: MockTopup = {
  id: 1,
  status: "pending",
  amount: 50,
  admin_note: null,
  created_at: new Date().toISOString(),
};

describe("TopupWaitingModal — decision states are announced (96-F6 / R96 A6 #3)", () => {
  beforeEach(() => {
    listTopupsMock.mockReset();
  });

  it("approved state renders a polite live status region", () => {
    renderModal({ ...BASE, status: "approved" });

    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-live", "polite");
    // The decision copy itself is inside the announced region.
    expect(region).toHaveTextContent("تمت إضافة الرصيد");
    expect(screen.getByText("+ 50.00 د.ل")).toBeInTheDocument();
  });

  it("rejected state renders an assertive alert region (incl. the admin note)", () => {
    renderModal({ ...BASE, status: "rejected", admin_note: "لم نعثر على التحويل" });

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("تم رفض الطلب");
    expect(alert).toHaveTextContent("لم نعثر على التحويل");
  });

  it("waiting state keeps the countdown's own live region (unchanged behaviour)", () => {
    renderModal({ ...BASE, status: "pending" });

    expect(screen.getByText("تم استلام طلب الشحن")).toBeInTheDocument();
    // The initial cosmetic countdown (30s) is the polite/atomic live
    // region from the pre-fix design — it must survive the round-96 fix.
    const countdown = screen.getByText("30");
    expect(countdown).toHaveAttribute("aria-live", "polite");
    expect(countdown).toHaveAttribute("aria-atomic", "true");
    // No decision region while waiting.
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("TopupWaitingModal — the dialog is NAMED per state (F3-04 / R111, WCAG 4.1.2)", () => {
  // Each body's heading is a real DialogTitle, so Radix wires
  // aria-labelledby on the DialogContent — screen readers announce
  // «تم استلام طلب الشحن، حوار» instead of an unnamed "dialog".
  it.each([
    ["pending", "تم استلام طلب الشحن"],
    ["approved", "تمت إضافة الرصيد"],
    ["rejected", "تم رفض الطلب"],
  ] as const)(
    "the %s state exposes its heading as the dialog's accessible name",
    (status, name) => {
      renderModal({ ...BASE, status });
      expect(screen.getByRole("dialog", { name })).toBeInTheDocument();
    },
  );

  it("the timed-out waiting copy renames the dialog too", () => {
    vi.useFakeTimers();
    try {
      renderModal({ ...BASE, status: "pending" });
      act(() => {
        vi.advanceTimersByTime(30_000);
      });
      expect(screen.getByRole("dialog", { name: "ما زلنا نراجع طلبك" })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
