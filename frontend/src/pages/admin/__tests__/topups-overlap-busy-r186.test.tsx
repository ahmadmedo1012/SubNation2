/**
 * R186 (C-F10) — per-row busy under OVERLAPPING approvals (the
 * topups money queue).
 *
 * The single `processingId` assumed serial money actions: approving
 * topup A then confirming approve on topup B mid-flight re-enabled A's
 * card (setProcessingId(B) overwrote A), and A's success then re-enabled
 * B's card while B's POST was still running — the per-row disabled
 * contract broke exactly when an operator worked the queue in parallel.
 * Money stayed contained server-side (status guard + per-click
 * Idempotency-Keys); the casualty was the busy contract (and a spurious
 * «فشلت الموافقة» toast if the mid-flight row was re-tapped).
 *
 * The fix is the orders.tsx credentialsInFlight Set idiom: each money
 * POST adds its OWN id and deletes it — and only it — when it settles.
 * Pinned here with two gated (slow) approve POSTs:
 *
 *   1. approve A, then approve B while A is in flight — both cards busy;
 *   2. resolve A → B's buttons REMAIN disabled (was: re-enabled);
 *   3. resolve B → B's buttons re-enable (the set empties cleanly).
 *
 * `@workspace/api-client-react`, `@/lib/auth`, the admin shell and the
 * toast hook are mocked at the module boundary (the
 * topups-approve-all.test.tsx harness).
 */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { beforeEach, afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { type ReactNode } from "react";
import AdminTopupsPage from "@/pages/admin/topups";
import { approveTopup, customFetch } from "@workspace/api-client-react";

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

const PENDING = [
  {
    id: 11,
    amount: 50,
    status: "pending",
    user_phone: "0911111111",
    payment_method: "mobile_transfer",
    created_at: "2026-09-01T10:00:00.000Z",
  },
  {
    id: 12,
    amount: 75,
    status: "pending",
    user_phone: "0912222222",
    payment_method: "mobile_transfer",
    created_at: "2026-09-01T11:00:00.000Z",
  },
];

const APPROVED = { success: true };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
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

/** The card that renders the given topup — scoped by the per-id row-selector
 *  checkbox (always present on pending cards) and bounded by the first
 *  ancestor holding a «رفض» button, so a mid-flight card whose approve
 *  label reads «جارٍ…» (no «موافقة» bytes) still scopes to ITSELF — the
 *  original textContent walk escaped to the two-card container exactly
 *  when the overlap it pins began. */
function cardScope(topupId: number) {
  const el = screen.getByRole("button", { name: `تحديد طلب الشحن ${topupId} للإجراء الجماعي` });
  let node: HTMLElement | null = el.closest("div");
  while (node) {
    if ([...node.querySelectorAll("button")].some((b) => (b.textContent ?? "").includes("رفض"))) {
      return within(node);
    }
    node = node.parentElement;
  }
  throw new Error(`card not found for ${topupId}`);
}

/** Opens the single-approve confirm dialog for a row and confirms it. */
async function confirmApprove(topupId: number) {
  fireEvent.click(cardScope(topupId).getByRole("button", { name: "موافقة" }));
  const title = await screen.findByText("تأكيد الموافقة");
  const dialog = title.closest('[role="alertdialog"]') as HTMLElement;
  fireEvent.click(within(dialog).getByRole("button", { name: "موافقة" }));
  await waitFor(() => {
    expect(screen.queryByText("تأكيد الموافقة")).not.toBeInTheDocument();
  });
}

describe("AdminTopupsPage — per-row busy survives overlapping approvals (R186 C-F10)", () => {
  let gateA: { promise: unknown; resolve: (v: unknown) => void };
  let gateB: { promise: unknown; resolve: (v: unknown) => void };

  beforeEach(() => {
    vi.clearAllMocks();
    (customFetch as unknown as Mock).mockResolvedValue(PENDING);
    gateA = deferred<unknown>();
    gateB = deferred<unknown>();
    (approveTopup as unknown as Mock).mockImplementation(async (id: number) => {
      if (id === 11) return gateA.promise;
      if (id === 12) return gateB.promise;
      return APPROVED;
    });
    toastMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("approving A then B keeps BOTH cards busy; resolving A leaves B's buttons disabled; resolving B re-enables", async () => {
    renderPage();
    await screen.findByText("0911111111");

    // Approve A (POST gated in flight)…
    await confirmApprove(11);
    await waitFor(() => expect(approveTopup).toHaveBeenCalledTimes(1));
    // …then approve B while A is still in flight (the overlap the old
    // single-id model broke on).
    await confirmApprove(12);
    await waitFor(() => expect(approveTopup).toHaveBeenCalledTimes(2));

    // Both cards busy: approve AND reject disabled on each.
    for (const id of [11, 12]) {
      expect(cardScope(id).getByRole("button", { name: /موافقة|جارٍ/ })).toBeDisabled();
      expect(cardScope(id).getByRole("button", { name: "رفض" })).toBeDisabled();
    }

    // A lands → A's toast fires, A's card re-enables…
    gateA.resolve(APPROVED);
    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ title: "تمت الموافقة", variant: "success" }),
      );
    });
    await waitFor(() => {
      expect(cardScope(11).getByRole("button", { name: "موافقة" })).toBeEnabled();
    });

    // …but B's POST is STILL in flight — its buttons stay disabled (the
    // old single-id model re-enabled B here via setProcessingId(null)).
    expect(cardScope(12).getByRole("button", { name: "جارٍ…" })).toBeDisabled();
    expect(cardScope(12).getByRole("button", { name: "رفض" })).toBeDisabled();

    // B lands → its own card re-enables cleanly (the set empties).
    gateB.resolve(APPROVED);
    await waitFor(() => {
      expect(cardScope(12).getByRole("button", { name: "موافقة" })).toBeEnabled();
    });
    expect(approveTopup).toHaveBeenCalledTimes(2);
  });
});
