/**
 * 93-C6 / F-07 (round-93 — A5 S-1/U-1) — users wallet-adjust
 * confirmation tests.
 *
 * The edit modal's "حفظ" submitted the wallet PATCH directly:
 *
 *   - No confirmation, no resulting-balance preview — a typo like 50
 *     instead of 5.00 overwrote/credited a wallet in one tap ("set"
 *     mode especially).
 *   - A NON-NUMERIC wallet value was silently DROPPED from the body
 *     (parseFloat NaN → field omitted) while loyalty fields still
 *     saved — the toast said "تم الحفظ" without the money change
 *     (U-1).
 *
 * The fix (same useConfirm idiom as the orders bulk refund):
 *   1. Non-numeric wallet input blocks the submit (destructive toast).
 *   2. A wallet change opens a styled confirm dialog showing the exact
 *      amount, the current balance, and the RESULTING balance.
 *   3. Cancel = no PATCH; confirm = the PATCH fires once with the
 *      idempotency key.
 *
 * `@workspace/api-client-react`, `@/lib/auth`, the admin shell and the
 * toast hook are mocked at the module boundary (vitest-config pattern).
 */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { beforeEach, afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { type ReactNode } from "react";
import AdminUsersPage from "@/pages/admin/users";
import { useListAdminUsers } from "@workspace/api-client-react";

vi.mock("@workspace/api-client-react", () => ({
  useListAdminUsers: vi.fn(),
  getListAdminUsersQueryKey: (params?: unknown) => ["/api/admin/users", params ?? null],
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

type UsersResult = ReturnType<typeof useListAdminUsers>;

const USER = {
  id: 16,
  phone: "0913456789",
  wallet_balance: 150,
  loyalty_points: 100,
  loyalty_tier: "bronze",
  order_count: 2,
  lifetime_spend: 200,
  created_at: "2026-08-01T10:00:00.000Z",
};

function mockUsersResult(data: unknown[], over: Partial<UsersResult> = {}) {
  (useListAdminUsers as unknown as Mock).mockReturnValue({
    data,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...over,
  } as unknown as UsersResult);
}

/** Minimal Response-like object — avoids depending on a global Response. */
function resLike(over: { ok?: boolean; status?: number; body?: unknown } = {}) {
  const { ok = true, status = 200, body = {} } = over;
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

const fetchMock = vi.fn();

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Router>
        <AdminUsersPage />
      </Router>
    </QueryClientProvider>,
  );
}

/** Opens the edit modal for the first user row. */
function openEditModal() {
  fireEvent.click(screen.getByRole("button", { name: /تعديل المستخدم 0913456789/ }));
  return screen.getByText("تعديل المستخدم").closest("div.fixed") as HTMLElement;
}

/** The wallet amount input inside the edit modal (placeholder follows the selected mode). */
function walletInput(modal: HTMLElement, placeholder: string) {
  return within(modal).getByPlaceholderText(placeholder);
}

async function openWalletConfirm(
  modal: HTMLElement,
  amount: string,
  placeholder = "المبلغ للإضافة",
) {
  fireEvent.change(walletInput(modal, placeholder), { target: { value: amount } });
  fireEvent.click(within(modal).getByRole("button", { name: "حفظ" }));
  // The useConfirm AlertDialog (rendered at page level) opens.
  const title = await screen.findByText("تأكيد تعديل المحفظة");
  const dialog = title.closest('[role="alertdialog"]') as HTMLElement;
  expect(dialog).toBeTruthy();
  return dialog;
}

describe("AdminUsersPage — wallet adjust confirmation (S-1/U-1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUsersResult([USER]);
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("a wallet change opens a confirm dialog with the resulting-balance preview BEFORE any request", async () => {
    renderPage();

    const modal = openEditModal();
    const dialog = await openWalletConfirm(modal, "25");

    // Amount + current + resulting balance are all visible.
    expect(within(dialog).getByText(/سيتم إضافة 25\.00 د\.ل/)).toBeInTheDocument();
    expect(within(dialog).getByText(/الرصيد الجديد: 175\.00 د\.ل/)).toBeInTheDocument();
    // Submit is gated: no PATCH has fired yet.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cancel performs no PATCH (submit gated by the dialog)", async () => {
    renderPage();

    const modal = openEditModal();
    const dialog = await openWalletConfirm(modal, "25");

    fireEvent.click(within(dialog).getByRole("button", { name: "إلغاء" }));
    await waitFor(() => expect(screen.queryByText("تأكيد تعديل المحفظة")).not.toBeInTheDocument());

    expect(fetchMock).not.toHaveBeenCalled();
    // The edit modal itself stays open (its own إلغاء is separate).
    expect(screen.getByText("تعديل المستخدم")).toBeInTheDocument();
  });

  it("confirm fires the PATCH once with the amount + Idempotency-Key", async () => {
    fetchMock.mockResolvedValue(
      resLike({ body: { id: 16, wallet_balance: 175, loyalty_points: 100 } }),
    );
    renderPage();

    const modal = openEditModal();
    const dialog = await openWalletConfirm(modal, "25");

    fireEvent.click(within(dialog).getByRole("button", { name: "تنفيذ التعديل" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/admin/users/16");
    expect(init.method).toBe("PATCH");
    expect(init.headers).toMatchObject({ "Idempotency-Key": expect.any(String) });
    expect(JSON.parse(String(init.body))).toMatchObject({ wallet_adjustment: 25 });

    await waitFor(() => expect(toastMock).toHaveBeenCalledTimes(1));
    expect(toastMock.mock.calls[0][0].title).toBe("تم الحفظ");
  });

  it("subtract mode previews the deduction and flags an overdrawn result", async () => {
    renderPage();

    const modal = openEditModal();
    // Switch to خصم mode (the placeholder follows the mode).
    fireEvent.click(within(modal).getByRole("button", { name: /خصم/ }));
    const dialog = await openWalletConfirm(modal, "200", "المبلغ للخصم");

    // 150 - 200 = -50 → preview + explicit overdraw warning.
    expect(within(dialog).getByText(/سيتم خصم 200\.00 د\.ل/)).toBeInTheDocument();
    expect(within(dialog).getByText(/الرصيد الجديد: -50\.00 د\.ل/)).toBeInTheDocument();
    expect(within(dialog).getByText(/يتجاوز الرصيد الحالي/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a negative wallet value never reaches the PATCH (layered guard)", () => {
    renderPage();

    const modal = openEditModal();
    // "abc" is sanitized to "" by the number input itself; "-5"
    // survives as a value but fails the input's min=0 constraint —
    // the browser's interactive validation blocks the form submit
    // entirely (verified: jsdom fires no submit event). handleSave's
    // own isFinite/>=0 check is the second layer for novalidate /
    // programmatic-submit paths. Either way, the OLD silent-drop
    // behavior (loyalty saved + "تم الحفظ" while the money field
    // vanished from the body, U-1) is impossible: nothing is sent.
    fireEvent.change(walletInput(modal, "المبلغ للإضافة"), { target: { value: "-5" } });
    fireEvent.click(within(modal).getByRole("button", { name: "حفظ" }));

    expect(screen.queryByText("تأكيد تعديل المحفظة")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    // No false "تم الحفظ" success toast for a blocked submit.
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("a loyalty-only save (no wallet change) does not open the money confirm", async () => {
    fetchMock.mockResolvedValue(resLike({ body: { id: 16 } }));
    renderPage();

    const modal = openEditModal();
    // Wallet input left EMPTY → loyalty-only PATCH, no money dialog.
    fireEvent.click(within(modal).getByRole("button", { name: "حفظ" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("تأكيد تعديل المحفظة")).not.toBeInTheDocument();
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toMatchObject({
      loyalty_points: 100,
    });
  });
});
