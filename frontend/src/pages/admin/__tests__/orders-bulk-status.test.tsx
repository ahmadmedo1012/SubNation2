/**
 * B5-02 + B5-05 (round-92 audit) — orders bulk status/refund feedback tests.
 *
 * `applyBulkStatus` (which includes BULK REFUND — a money action) used to
 * complete silently: the error path toasted, the success path only
 * refetched the table. The backend also returns an explicit 207 partial
 * shape (`{ updated, failed: [{ orderId, code, message }] }`) when some
 * refunds can't be applied — `Response.ok` is true for 207, so that body
 * was parsed never and a half-failed batch looked like full success.
 * The raw `window.confirm` was additionally replaced by the shared
 * `useConfirm` AlertDialog (B5-05). These tests pin:
 *
 *   1. The styled confirm dialog opens with the original wording; cancel
 *      performs no request.
 *   2. Full success → a success toast WITH COUNTS (was silent).
 *   3. 207 partial → destructive toast: "تم تحديث X من N" + per-failure
 *      Arabic reasons.
 *
 * `@workspace/api-client-react`, `@/lib/auth`, the admin shell and the
 * toast hook are mocked at the module boundary (vitest-config pattern).
 */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { type ReactNode } from "react";
import AdminOrdersPage from "@/pages/admin/orders";
import { listAdminOrders } from "@workspace/api-client-react";

vi.mock("@workspace/api-client-react", () => ({
  // 94-C2 (A2 P1-1): the list moved from the generated useListAdminOrders
  // hook to useInfiniteQuery + listAdminOrders over the frozen
  // `?page=&limit=` contract — the mock follows the new module surface.
  listAdminOrders: vi.fn(),
  getListAdminOrdersQueryKey: (params?: unknown) => ["/api/admin/orders", params ?? null],
  // 93-C6: useAdminHeaders registers the global 401 observer through
  // this export — the mock must carry the module surface the page
  // graph imports.
  setUnauthorizedHandler: vi.fn(),
}));

// R120-B4 (A2-F4): the auth mock reads from hoisted mutable state so
// the finance-gating test can flip the scope per-test (default: granted,
// matching the pre-existing tests).
const { authState } = vi.hoisted(() => ({ authState: { finance: true } }));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    adminToken: "test-admin-token",
    hasAdminPermission: (scope: string) => authState[scope] !== false,
  }),
}));

vi.mock("@/pages/admin/layout", () => ({
  AdminLayout: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock, dismiss: vi.fn() }),
}));

function mockOrdersResult(data: unknown[]) {
  // 94-C2 (A2 P1-1): the page's useInfiniteQuery resolves this promise
  // as page 1 — the rows land asynchronously, so tests await them.
  (listAdminOrders as unknown as Mock).mockResolvedValue(data);
}

const ORDERS = [
  {
    id: 1,
    order_code: "SN-1001",
    user_phone: "0911111111",
    product_name: "Netflix 1M",
    amount: 25,
    status: "completed",
    created_at: "2026-09-01T10:00:00.000Z",
  },
  {
    id: 2,
    order_code: "SN-1002",
    user_phone: "0912222222",
    product_name: "Spotify 3M",
    amount: 40,
    status: "completed",
    created_at: "2026-09-02T10:00:00.000Z",
  },
];

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
        <AdminOrdersPage />
      </Router>
    </QueryClientProvider>,
  );
}

/** Toggles the desktop row checkbox for an order code. The desktop
 *  table renders before the mobile card list, so index 0 is the td.
 *  F3-08 (R111): the select toggle is now named «تحديد الطلب … للإجراء
 *  الجماعي» — target it by name (the row also carries the F3-02
 *  keyboard expand toggle, so an unscoped getByRole("button") would
 *  match both). */
function selectRow(orderCode: string) {
  const cell = screen.getAllByText(orderCode)[0];
  const row = cell.closest("tr");
  if (!row) throw new Error(`desktop row for ${orderCode} not found`);
  fireEvent.click(within(row).getByRole("button", { name: /للإجراء الجماعي/ }));
}

/** Selects both orders, opens the bulk-status dropdown and clicks the
 *  given status — returns the scoped useConfirm dialog once it opens.
 *  R120-B4 (A2-F19): the menu items now carry role="menuitem". */
async function openBulkConfirm(statusLabel: string) {
  // 94-C2: the list is async (useInfiniteQuery) — wait for the rows.
  await screen.findAllByText("SN-1001");
  selectRow("SN-1001");
  selectRow("SN-1002");
  expect(screen.getByText("2 طلب محدد")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "تغيير الحالة" }));
  // The dropdown lives in the same relative anchor as its trigger —
  // scope so the item is not confused with the equal-named filter tab.
  const anchor = screen.getByRole("button", { name: "تغيير الحالة" }).parentElement;
  if (!anchor) throw new Error("dropdown anchor not found");
  fireEvent.click(within(anchor).getByRole("menuitem", { name: statusLabel }));

  const title = await screen.findByText("استرداد جماعي للطلبات");
  const dialog = title.closest('[role="alertdialog"]');
  if (!dialog) throw new Error("confirm dialog not rendered");
  return within(dialog as HTMLElement);
}

describe("AdminOrdersPage — bulk status / bulk refund feedback (B5-02 + B5-05)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOrdersResult(ORDERS);
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("confirms via the styled AlertDialog with the original wording; cancel = no request", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockImplementation(() => true);
    fetchMock.mockResolvedValue(resLike());
    renderPage();

    const dialog = await openBulkConfirm("مُسترد");
    expect(dialog.getByText(/سيتم استرداد المبالغ للمستخدمين/)).toBeInTheDocument();

    fireEvent.click(dialog.getByRole("button", { name: "إلغاء" }));

    // No PATCH ever happened (the list query is a mock — only the
    // bulk-status endpoint would use fetch), and no native confirm.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("fires a success toast WITH COUNTS on a full bulk refund (was silent)", async () => {
    fetchMock.mockResolvedValue(resLike({ body: { success: true, updated: 2 } }));
    renderPage();

    const dialog = await openBulkConfirm("مُسترد");
    fireEvent.click(dialog.getByRole("button", { name: "استرداد" }));

    await waitFor(() => expect(toastMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/admin/orders/bulk-status");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toMatchObject({ ids: [1, 2], status: "refunded" });

    const toastArg = toastMock.mock.calls[0][0];
    expect(toastArg.title).toBe("تم استرداد 2 طلب");
    expect(toastArg.variant).toBe("success");
  });

  it("surfaces the 207 partial-failure shape: counts + per-failure Arabic reasons", async () => {
    // Response.ok is TRUE for 207 — the partial body must be parsed,
    // never treated as full success.
    fetchMock.mockResolvedValue(
      resLike({
        status: 207,
        body: {
          success: false,
          updated: 1,
          failed: [{ orderId: 1, code: "ALREADY_REFUNDED", message: "already refunded" }],
        },
      }),
    );
    renderPage();

    const dialog = await openBulkConfirm("مُسترد");
    fireEvent.click(dialog.getByRole("button", { name: "استرداد" }));

    await waitFor(() => expect(toastMock).toHaveBeenCalledTimes(1));
    const toastArg = toastMock.mock.calls[0][0];
    expect(toastArg.title).toBe("تم تحديث 1 من 2 طلب");
    expect(toastArg.description).toContain("فشلت 1");
    expect(toastArg.description).toContain("#1");
    // RefundService code mapped to its Arabic reason.
    expect(toastArg.description).toContain("مُسترد مسبقاً");
    expect(toastArg.variant).toBe("destructive");
  });

  it("non-refund bulk transitions toast the new status with counts", async () => {
    fetchMock.mockResolvedValue(resLike({ body: { success: true, updated: 2 } }));
    renderPage();

    // 94-C2: the list is async — wait for the rows before selecting.
    await screen.findAllByText("SN-1001");
    selectRow("SN-1001");
    selectRow("SN-1002");
    fireEvent.click(screen.getByRole("button", { name: "تغيير الحالة" }));
    const anchor = screen.getByRole("button", { name: "تغيير الحالة" }).parentElement!;
    fireEvent.click(within(anchor).getByRole("menuitem", { name: "مكتمل" }));

    const title = await screen.findByText("تغيير الحالة الجماعي");
    const dialog = title.closest('[role="alertdialog"]')!;
    fireEvent.click(within(dialog as HTMLElement).getByRole("button", { name: "تغيير الحالة" }));

    await waitFor(() => expect(toastMock).toHaveBeenCalledTimes(1));
    const toastArg = toastMock.mock.calls[0][0];
    expect(toastArg.title).toBe("تم تحديث حالة 2 طلب");
    expect(toastArg.description).toContain("مكتمل");
    expect(toastArg.variant).toBe("success");
  });
});

/** R120-B4 (A2-F4 + A2-F19) — the bulk menu follows the backend's RBAC
 *  gate (refund = finance) and carries real menu semantics. */
describe("AdminOrdersPage — finance-gated refund option + menu semantics (R120-B4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOrdersResult(ORDERS);
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    authState.finance = true;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    authState.finance = true;
  });

  async function openBulkMenu(): Promise<HTMLElement> {
    await screen.findAllByText("SN-1001");
    selectRow("SN-1001");
    fireEvent.click(screen.getByRole("button", { name: "تغيير الحالة" }));
    const anchor = screen.getByRole("button", { name: "تغيير الحالة" }).parentElement;
    if (!anchor) throw new Error("dropdown anchor not found");
    return anchor;
  }

  it("an orders-scope-only admin does NOT see the refund option (the backend 403s it)", async () => {
    authState.finance = false;
    renderPage();

    const anchor = await openBulkMenu();
    const menu = within(anchor).getByRole("menu");
    // The refund entry is gone…
    expect(within(menu).queryByRole("menuitem", { name: "مُسترد" })).not.toBeInTheDocument();
    // …while the non-money transitions stay offered.
    expect(within(menu).getByRole("menuitem", { name: "مكتمل" })).toBeInTheDocument();
    expect(within(menu).getAllByRole("menuitem").length).toBe(3);
  });

  it("a finance admin still sees the refund option", async () => {
    renderPage();

    const anchor = await openBulkMenu();
    const menu = within(anchor).getByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "مُسترد" })).toBeInTheDocument();
    expect(within(menu).getAllByRole("menuitem").length).toBe(4);
  });

  it("carries role=menu; ESC closes it and returns focus to the trigger", async () => {
    renderPage();

    const anchor = await openBulkMenu();
    const menu = within(anchor).getByRole("menu");
    expect(menu).toBeInTheDocument();

    // ESC on the menu closes it…
    fireEvent.keyDown(menu, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    // …and focus returns to the trigger button.
    await waitFor(() => expect(screen.getByRole("button", { name: "تغيير الحالة" })).toHaveFocus());
  });
});
