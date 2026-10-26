/**
 * R187 (D-F10) — the bulk loop's scope must EQUAL the confirm's scope.
 *
 * The confirm modal + the toolbar count chips already counted
 * pending∩selected — but handleBulkAction sent the RAW selection set:
 * a topup approved in another tab/session (its row pruned from pending
 * on the next refetch — the checkbox gone, the id still in
 * selectedIds) rode along as an N+1th request that 409'd into an
 * unexplained «N من N+1» toast for a row not visible anywhere.
 *
 * The loop now derives ids from pendingTopups∩selectedIds — exactly
 * the counted scope. This pins the equivalence end-to-end through the
 * real page: select two pending rows, flip one to approved server-side,
 * refetch, then run the bulk approve — the fetcher receives ONLY the
 * still-pending id, and the confirm modal names the same count.
 */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { type ReactNode } from "react";
import AdminTopupsPage from "@/pages/admin/topups";
import { customFetch } from "@workspace/api-client-react";
import { approveTopup } from "@workspace/api-client-react";

vi.mock("@workspace/api-client-react", () => ({
  customFetch: vi.fn(),
  getListAdminTopupsQueryKey: () => ["admin-topups"],
  approveTopup: vi.fn(),
  rejectTopup: vi.fn(),
  setUnauthorizedHandler: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ adminToken: "test-admin-token", hasAdminPermission: () => true }),
}));

vi.mock("@/pages/admin/layout", () => ({
  AdminLayout: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));
vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({ toast: toastMock, dismiss: vi.fn() }),
}));

const PENDING_11 = {
  id: 11,
  amount: 50,
  status: "pending",
  user_phone: "0911111111",
  payment_method: "mobile_transfer",
  created_at: "2026-09-01T10:00:00.000Z",
};
const PENDING_12 = {
  id: 12,
  amount: 75,
  status: "pending",
  user_phone: "0912222222",
  payment_method: "mobile_transfer",
  created_at: "2026-09-01T11:00:00.000Z",
};
/** The same row 12 AFTER another operator approved it — the refetch
 *  prunes it from pending (its checkbox vanishes) while selectedIds
 *  still carries the id: the exact stale-selection premise. */
const APPROVED_12 = { ...PENDING_12, status: "approved" };

const APPROVED = { success: true };

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <Router>
          <AdminTopupsPage />
        </Router>
      </QueryClientProvider>,
    ),
  };
}

function selectRow(topupId: number) {
  fireEvent.click(
    screen.getByRole("button", { name: `تحديد طلب الشحن ${topupId} للإجراء الجماعي` }),
  );
}

/** The BulkConfirmModal overlay — scoped by its fixed-position shell
 *  (the topups-approve-all suite's bulkDialog idiom). */
function bulkDialog() {
  const overlay = screen.getByText("تأكيد الموافقة الجماعية").closest("div.fixed");
  if (!overlay) throw new Error("bulk confirm modal not rendered");
  return within(overlay as HTMLElement);
}

describe("AdminTopupsPage — the bulk loop sends the CONFIRMED scope (R187 D-F10)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (customFetch as unknown as Mock).mockResolvedValue([PENDING_11, PENDING_12]);
    (approveTopup as unknown as Mock).mockResolvedValue(APPROVED);
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("a stale selection id (its row approved elsewhere) never rides the bulk POST", async () => {
    const { client } = renderPage();

    // Wait for the queue to render before selecting.
    await screen.findByRole("button", { name: "تحديد طلب الشحن 11 للإجراء الجماعي" });
    // Select BOTH pending rows while both are still pending.
    selectRow(11);
    selectRow(12);

    // The other operator approves row 12; the refetch brings the truth.
    (customFetch as unknown as Mock).mockResolvedValue([PENDING_11, APPROVED_12]);
    await client.refetchQueries();
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "تحديد طلب الشحن 12 للإجراء الجماعي" }),
      ).toBeNull();
    });

    // The toolbar's bulk trigger counts the CONFIRMED scope: 1, not 2.
    const bulkApprove = await screen.findByRole("button", { name: /موافقة \(1\)/ });
    fireEvent.click(bulkApprove);

    // The confirm modal names the same counted scope.
    // R188-5 (D-F5): the verbal-noun restructure («سيتم معالجة N»).
    expect(bulkDialog().getByText(/سيتم معالجة 1 طلب/)).toBeInTheDocument();

    fireEvent.click(bulkDialog().getByRole("button", { name: "موافقة" }));

    // The loop POSTs exactly the still-pending id — the stale id 12
    // never reaches the fetcher (the old Array.from(selectedIds) shape
    // fired [11, 12] here). Wait for the loop to COMPLETE (its summary
    // toast fires after the finally block) before counting — an early
    // count would race the sequential per-id awaits.
    await waitFor(() => expect(toastMock).toHaveBeenCalled());
    expect(approveTopup).toHaveBeenCalledTimes(1);
    expect((approveTopup as unknown as Mock).mock.calls[0][0]).toBe(11);
    expect((approveTopup as unknown as Mock).mock.calls.map((c) => c[0])).not.toContain(12);
  });

  it("the happy path is unchanged: two selected pending rows both POST", async () => {
    renderPage();

    await screen.findByRole("button", { name: "تحديد طلب الشحن 11 للإجراء الجماعي" });
    selectRow(11);
    selectRow(12);

    const bulkApprove = await screen.findByRole("button", { name: /موافقة \(2\)/ });
    fireEvent.click(bulkApprove);

    // The modal opened — then confirm through its own button.
    await screen.findByText("تأكيد الموافقة الجماعية");
    fireEvent.click(bulkDialog().getByRole("button", { name: "موافقة" }));

    await waitFor(() => expect(toastMock).toHaveBeenCalled());
    expect(approveTopup).toHaveBeenCalledTimes(2);
    const ids = (approveTopup as unknown as Mock).mock.calls.map((c) => c[0]);
    expect(ids).toEqual(expect.arrayContaining([11, 12]));
  });
});
