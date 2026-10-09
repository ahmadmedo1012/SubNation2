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
 * R116-S2 (P2/P3) additions:
 *   - the shell migrated to AppDialog — the accessible NAME now rides
 *     the header title (per state), so the name-wiring assertions
 *     below also cover the migration;
 *   - the modal's mobile geometry (bottom sheet + dvh cap + sm:max-w-md)
 *     and the 44px action buttons — the expectations folded in from the
 *     deleted components/ui/dialog.tsx (dialog-mobile.test.tsx);
 *   - the ~10 s «إغلاق والمتابعة» dismiss affordance (was a full 30 s
 *     lock that read as a frozen modal).
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

  it("approved state renders a polite live status region (R116-S2: title rides the header)", () => {
    renderModal({ ...BASE, status: "approved" });

    // The state heading is the DIALOG's accessible name (AppDialog title).
    expect(screen.getByRole("dialog", { name: "تمت إضافة الرصيد" })).toBeInTheDocument();
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-live", "polite");
    // The receipt copy is inside the announced region.
    expect(region).toHaveTextContent("تم اعتماد طلب الشحن وإضافته إلى محفظتك.");
    expect(screen.getByText("+ 50.00 د.ل")).toBeInTheDocument();
  });

  it("rejected state renders an assertive alert region (incl. the admin note)", () => {
    renderModal({ ...BASE, status: "rejected", admin_note: "لم نعثر على التحويل" });

    expect(screen.getByRole("dialog", { name: "تم رفض الطلب" })).toBeInTheDocument();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("لم نعثر على التحويل");
  });

  it("waiting state keeps the countdown's own live region (unchanged behaviour)", () => {
    renderModal({ ...BASE, status: "pending" });

    expect(screen.getByRole("dialog", { name: "تم استلام طلب الشحن" })).toBeInTheDocument();
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
  // Each state's heading is the AppDialog title, so Radix wires
  // aria-labelledby on the content — screen readers announce
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

describe("TopupWaitingModal — ~10s dismiss affordance (R116-S2 / P2)", () => {
  it("locks close actions for the first ~10 s of the countdown", () => {
    vi.useFakeTimers();
    try {
      renderModal({ ...BASE, status: "pending" });

      // 9 s in: still locked — no «إغلاق والمتابعة» body affordance and
      // the header close is disabled (AppDialog dismissable=false).
      act(() => {
        vi.advanceTimersByTime(9_000);
      });
      expect(screen.queryByRole("button", { name: "إغلاق والمتابعة" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "إغلاق" })).toBeDisabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("unlocks at ~10 s: the «إغلاق والمتابعة» button appears + the header close enables", () => {
    vi.useFakeTimers();
    try {
      renderModal({ ...BASE, status: "pending" });
      act(() => {
        vi.advanceTimersByTime(10_000);
      });

      const close = screen.getByRole("button", { name: "إغلاق والمتابعة" });
      expect(close).toBeInTheDocument();
      // R116-S2 (P2/P3): the 44px touch floor on every modal action.
      expect(close.className).toContain("min-h-11");
      expect(screen.getByRole("button", { name: "إغلاق" })).toBeEnabled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("TopupWaitingModal — AppDialog mobile geometry (R116-S2, folded from ui/dialog)", () => {
  // The legacy components/ui/dialog.tsx was deleted; its mobile-geometry
  // contract lives on through the shared AppDialog shell this modal now
  // rides. Assertions are re-scoped to the modal's OWN dialog element.
  function dialogEl(): HTMLElement {
    return screen.getByRole("dialog");
  }

  it("renders the AppDialog mobile bottom-sheet geometry (rounded top, bottom-anchored, dvh cap)", () => {
    renderModal({ ...BASE, status: "approved" });

    const cls = dialogEl().className;
    // Mobile: full-width bottom sheet…
    expect(cls).toContain("bottom-0");
    expect(cls).toContain("rounded-t-2xl");
    // …that becomes a centered card ≥sm, capped at the md preset.
    expect(cls).toContain("sm:max-w-md");
    // Long Arabic content: the card is capped + the body scrolls.
    expect(cls).toContain("max-h-[85dvh]");
  });

  it("the header close keeps the 44px hit box (94-C3 / A3 P1-3)", () => {
    renderModal({ ...BASE, status: "approved" });

    const close = screen.getByRole("button", { name: "إغلاق" });
    expect(close.className).toContain("h-11 w-11");
  });

  it("every full-width action button clears the 44px touch floor", () => {
    // Approved state: the body's primary «تم» (the header close is the
    // h-11 w-11 icon button pinned above — a different element).
    renderModal({ ...BASE, status: "approved" });
    const done = screen.getByRole("button", { name: "تم" });
    expect(done.className).toContain("min-h-11");

    // Rejected state: R124-I1 (A1 P3) replaced the body's full-width
    // «إغلاق» with the /support Link (primary) + the neutral
    // «البقاء في المحفظة» secondary — the header close is now the only
    // «إغلاق» in the rejected state.
    renderModal({ ...BASE, status: "rejected", id: 2 });
    const support = screen.getByRole("link", { name: "تواصل مع الدعم" });
    expect(support).toHaveAttribute("href", "/support");
    expect(support.className).toContain("min-h-11");
    const stay = screen.getByRole("button", { name: "البقاء في المحفظة" });
    expect(stay.className).toContain("min-h-11");
    expect(screen.getAllByRole("button", { name: "إغلاق" })).toHaveLength(1);
  });
});
