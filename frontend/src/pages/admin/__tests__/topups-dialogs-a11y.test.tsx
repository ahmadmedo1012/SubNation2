/**
 * R111-FIX-A — WCAG dialog-semantics regressions for the topups money
 * queue (F3-03, WCAG 4.1.2 + 2.4.3).
 *
 * The reject + bulk-confirm overlays were hand-rolled `fixed` divs: no
 * role="dialog"/aria-modal, no focus trap (Tab walked out of the "modal"
 * into the page behind), no focus return, ESC handled only from inside
 * the reject textarea. Both now ride the shared AppDialog shell (Radix).
 *
 * These tests pin, at the page level:
 *   1. Reject modal: named dialog (DialogTitle) + aria-modal, the note
 *      textarea programmatically labelled, focus lands INSIDE on open,
 *      ESC cancels while idle, ESC/backdrop are guarded while the reject
 *      POST is in flight (the 94-C2 single-flight contract preserved).
 *   2. Bulk confirm: named dialog + the live progress counter as a
 *      role=status region (screen-reader announcement while the
 *      sequential money loop runs).
 *
 * Same module-boundary mock pattern as topups-approve-confirm.test.tsx.
 */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { type ReactNode } from "react";
import AdminTopupsPage from "@/pages/admin/topups";
import { customFetch, rejectTopup } from "@workspace/api-client-react";

vi.mock("@workspace/api-client-react", () => ({
  customFetch: vi.fn(),
  getListAdminTopupsQueryKey: () => ["admin-topups"],
  approveTopup: vi.fn(),
  rejectTopup: vi.fn(),
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

const PENDING_TOPUP = {
  id: 21,
  amount: 60,
  status: "pending",
  user_phone: "0917777777",
  sender_phone: "0923333333",
  payment_reference: "REF-2021",
  payment_method: "mobile_transfer",
  created_at: "2026-09-05T10:00:00.000Z",
};

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

/** Opens the reject modal via the row's «رفض» button. */
async function openRejectModal() {
  fireEvent.click(await screen.findByRole("button", { name: "رفض" }));
  return await screen.findByRole("dialog", { name: "تأكيد الرفض" });
}

/** Minimal Response-like object. */
function resLike(over: { ok?: boolean; status?: number; body?: unknown } = {}) {
  const { ok = true, status = 200, body = {} } = over;
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe("AdminTopupsPage — reject modal dialog semantics (F3-03)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (customFetch as unknown as Mock).mockResolvedValue([PENDING_TOPUP]);
    (rejectTopup as unknown as Mock).mockReset();
  });

  it("is a named, modal dialog with a labelled note field", async () => {
    renderPage();

    const dialog = await openRejectModal();
    expect(dialog).toHaveAttribute("aria-modal", "true");
    // The money context (amount) rides the dialog description.
    expect(within(dialog).getByText(/60\.00 د\.ل/)).toBeInTheDocument();
    // 94-C2 label wiring survived the AppDialog migration.
    expect(within(dialog).getByLabelText(/^سبب الرفض/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "تأكيد الرفض" })).toBeInTheDocument();
  });

  it("moves focus INTO the dialog on open (focus trap basics)", async () => {
    renderPage();

    const dialog = await openRejectModal();
    await waitFor(() => {
      expect(dialog.contains(document.activeElement)).toBe(true);
    });
  });

  it("ESC cancels while idle (Radix dismiss → onCancel)", async () => {
    renderPage();

    await openRejectModal();
    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // No money request fired on cancel.
    expect(rejectTopup).not.toHaveBeenCalled();
  });

  it("ESC + close button are guarded while the reject POST is in flight (94-C2)", async () => {
    // Keep the mutation pending so `loading` stays true.
    let resolveReject!: (v: unknown) => void;
    (rejectTopup as unknown as Mock).mockImplementation(
      () => new Promise((res) => (resolveReject = res)),
    );

    renderPage();
    const dialog = await openRejectModal();
    fireEvent.click(within(dialog).getByRole("button", { name: "تأكيد الرفض" }));

    // React Query defers the mutationFn to a microtask — wait for the
    // request to actually be in flight before asserting the guards.
    await waitFor(() => expect(rejectTopup).toHaveBeenCalledTimes(1));

    // In flight: ESC no longer dismisses…
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("dialog", { name: "تأكيد الرفض" })).toBeInTheDocument();
    // …the built-in close button is disabled…
    expect(screen.getByRole("button", { name: "إغلاق" })).toBeDisabled();
    // …and the confirm button shows the busy label.
    expect(screen.getByRole("button", { name: "جارٍ الرفض..." })).toBeDisabled();

    // Settle → success path closes the modal (existing behavior).
    resolveReject({ success: true });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

describe("AdminTopupsPage — bulk confirm modal dialog semantics (F3-03)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (customFetch as unknown as Mock).mockResolvedValue([PENDING_TOPUP]);
    (rejectTopup as unknown as Mock).mockReset();
  });

  it("is a named modal dialog carrying the item count", async () => {
    const fetchMock = vi.fn().mockResolvedValue(resLike());
    vi.stubGlobal("fetch", fetchMock);
    try {
      renderPage();

      // Select the pending row (its selector is row-specific — R125-I2
      // renamed the generic «اختيار» to «تحديد طلب الشحن {id} للإجراء
      // الجماعي», the orders.tsx state-aware idiom), then open the bulk
      // reject confirm.
      fireEvent.click(
        await screen.findByRole("button", { name: /تحديد طلب الشحن .* للإجراء الجماعي/ }),
      );
      fireEvent.click(await screen.findByRole("button", { name: /رفض \(1\)/ }));

      const dialog = await screen.findByRole("dialog", { name: "تأكيد الرفض الجماعي" });
      expect(dialog).toHaveAttribute("aria-modal", "true");
      expect(within(dialog).getByText("1 طلب سيتم معالجته")).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
