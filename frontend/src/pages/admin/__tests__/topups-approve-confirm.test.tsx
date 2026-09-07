/**
 * 93-C6 / F-07 (round-93 — A5 T-1/S-1) — topups single-approve
 * confirmation tests.
 *
 * The single "موافقة" button credited a wallet in ONE TAP: the
 * money-CREATING action fired immediately while REJECT — right next
 * to it — opened a full styled modal with the amount. (Bulk/approveAll
 * were fixed in round-92; single approve was not.)
 *
 * The fix: the shared useConfirm AlertDialog shows the amount + user
 * (+ sender/reference when present) BEFORE the POST fires. These tests
 * pin:
 *
 *   1. The dialog opens with the exact amount and phone.
 *   2. Cancel performs no request (approveTopup not called).
 *   3. Confirm fires the mutation with the per-click Idempotency-Key.
 *
 * `@workspace/api-client-react`, `@/lib/auth`, the admin shell and the
 * toast hook are mocked at the module boundary (vitest-config pattern).
 */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { type ReactNode } from "react";
import AdminTopupsPage from "@/pages/admin/topups";
import { approveTopup, useListAdminTopups } from "@workspace/api-client-react";

vi.mock("@workspace/api-client-react", () => ({
  useListAdminTopups: vi.fn(),
  getListAdminTopupsQueryKey: () => ["admin-topups"],
  approveTopup: vi.fn(),
  rejectTopup: vi.fn(),
  // 93-C6: useAdminHeaders registers the global 401 observer through
  // this export — the mock must carry the module surface the page
  // graph imports.
  setUnauthorizedHandler: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ adminToken: "test-admin-token" }),
}));

vi.mock("@/pages/admin/layout", () => ({
  AdminLayout: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock, dismiss: vi.fn() }),
}));

type TopupsResult = ReturnType<typeof useListAdminTopups>;

const PENDING_TOPUP = {
  id: 11,
  amount: 50,
  status: "pending",
  user_phone: "0911111111",
  sender_phone: "0922222222",
  payment_reference: "REF-9911",
  payment_method: "mobile_transfer",
  created_at: "2026-09-01T10:00:00.000Z",
};

function mockTopupsResult(data: unknown[], over: Partial<TopupsResult> = {}) {
  (useListAdminTopups as unknown as Mock).mockReturnValue({
    data,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...over,
  } as unknown as TopupsResult);
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Router>
        <AdminTopupsPage />
      </Router>
    </QueryClientProvider>,
  );
}

/** The per-row approve button (exact name match avoids the bulk
 *  "موافقة الكل" / "موافقة (N)" buttons). */
function rowApproveButton() {
  return screen.getAllByRole("button", { name: "موافقة" })[0];
}

async function openApproveConfirm() {
  fireEvent.click(rowApproveButton());
  const title = await screen.findByText("تأكيد الموافقة");
  const dialog = title.closest('[role="alertdialog"]') as HTMLElement;
  expect(dialog).toBeTruthy();
  return dialog;
}

describe("AdminTopupsPage — single approve confirmation (T-1/S-1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTopupsResult([PENDING_TOPUP]);
    (approveTopup as unknown as Mock).mockReset();
    (approveTopup as unknown as Mock).mockResolvedValue({ success: true });
  });

  it("opens a confirm dialog showing amount + wallet + sender + reference BEFORE the POST", async () => {
    renderPage();

    const dialog = await openApproveConfirm();

    // The money number an operator verifies is in the dialog.
    expect(within(dialog).getByText(/50\.00 د\.ل/)).toBeInTheDocument();
    expect(within(dialog).getByText(/0911111111/)).toBeInTheDocument();
    expect(within(dialog).getByText(/0922222222/)).toBeInTheDocument();
    expect(within(dialog).getByText(/REF-9911/)).toBeInTheDocument();
    // Submit gated: the mutation has not fired.
    expect(approveTopup).not.toHaveBeenCalled();
  });

  it("cancel performs no request (one-tap credit impossible)", async () => {
    renderPage();

    const dialog = await openApproveConfirm();
    fireEvent.click(within(dialog).getByRole("button", { name: "إلغاء" }));

    await waitFor(() => expect(screen.queryByText("تأكيد الموافقة")).not.toBeInTheDocument());
    expect(approveTopup).not.toHaveBeenCalled();
  });

  it("confirm fires the mutation once with the idempotency-keyed headers", async () => {
    renderPage();

    const dialog = await openApproveConfirm();
    fireEvent.click(within(dialog).getByRole("button", { name: "موافقة" }));

    await waitFor(() => expect(approveTopup).toHaveBeenCalledTimes(1));
    const [id, data, opts] = (approveTopup as unknown as Mock).mock.calls[0] as [
      number,
      { admin_note?: string },
      { headers?: Record<string, string> },
    ];
    expect(id).toBe(11);
    expect(data).toMatchObject({ admin_note: "تمت الموافقة" });
    // F-008: one Idempotency-Key per logical click.
    expect(opts.headers).toMatchObject({ "Idempotency-Key": expect.any(String) });

    // Success feedback includes the amount (not silent).
    await waitFor(() => expect(toastMock).toHaveBeenCalledTimes(1));
    expect(toastMock.mock.calls[0][0].title).toBe("✓ تمت الموافقة");
    expect(toastMock.mock.calls[0][0].description).toContain("50.00 د.ل");
  });

  it("approve mutation errors surface the parsed envelope, not a generic retry message", async () => {
    // C1's backend: 409 DUPLICATE_PAYMENT_REFERENCE carries a full
    // Arabic explanation in the body. The mutation's ApiError holds it
    // in `.data` — getErrorMessage must surface it (SIM P1).
    (approveTopup as unknown as Mock).mockRejectedValue(
      Object.assign(new Error("HTTP 409 Conflict: مرجع دفع مكرر"), {
        name: "ApiError",
        status: 409,
        data: { error: "مرجع دفع مكرر: يوجد طلب شحن معتمد مطابق (الطلبات: 21)" },
      }),
    );

    renderPage();
    const dialog = await openApproveConfirm();
    fireEvent.click(within(dialog).getByRole("button", { name: "موافقة" }));

    await waitFor(() => expect(toastMock).toHaveBeenCalledTimes(1));
    const toastArg = toastMock.mock.calls[0][0];
    expect(toastArg.title).toBe("فشلت الموافقة");
    expect(toastArg.description).toContain("مرجع دفع مكرر");
    expect(toastArg.variant).toBe("destructive");
  });
});
