/**
 * R120-B4 (A2-F6) — single-alert delete confirmation.
 *
 * The per-row delete was a ONE-TAP destructive action: the trash icon
 * fired DELETE /api/admin/alerts/:id immediately (every bulk path —
 * حذف المقروءة / حذف الكل — already carried confirmation friction).
 * A thumb slip on a phone destroyed an alert row with no way back.
 *
 * These tests pin the new contract:
 *
 *   1. The trash tap opens the shared useConfirm AlertDialog with the
 *      alert's title + type label in the description (the same context
 *      the bulk confirms carry).
 *   2. Cancel performs NO request.
 *   3. Confirm fires the DELETE for exactly that alert id.
 *
 * Module-boundary mocks follow alerts-load-more.test.tsx; useConfirm
 * itself runs REAL (its Radix AlertDialog is the surface under test).
 */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { beforeEach, afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { type ReactNode } from "react";
import AdminAlertsPage from "@/pages/admin/alerts";
import { customFetch } from "@workspace/api-client-react";

vi.mock("@workspace/api-client-react", () => ({
  customFetch: vi.fn(),
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

const PAGE_ONE = {
  alerts: [
    {
      id: 7,
      type: "low_stock" as const,
      title: "مخزون Netflix منخفض",
      message: "بقي 3 وحدات فقط",
      isRead: true,
      createdAt: "2026-09-08T10:00:00.000Z",
    },
  ],
  unreadCount: 0,
  total: 1,
  page: 1,
  limit: 50,
  hasMore: false,
};

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
        <AdminAlertsPage />
      </Router>
    </QueryClientProvider>,
  );
}

/** Opens the per-row delete confirm and returns the scoped dialog. */
async function openDeleteConfirm() {
  await screen.findByText("مخزون Netflix منخفض");
  fireEvent.click(screen.getByTitle("حذف"));

  const title = await screen.findByText("حذف التنبيه؟");
  const dialog = title.closest('[role="alertdialog"]');
  if (!dialog) throw new Error("delete confirm dialog not rendered");
  return within(dialog as HTMLElement);
}

describe("AdminAlertsPage — single-alert delete is confirmed, not one-tap (R120-B4 A2-F6)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (customFetch as unknown as Mock).mockResolvedValue(PAGE_ONE);
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("the trash tap opens the shared confirm naming the alert's title + type", async () => {
    renderPage();

    const dialog = await openDeleteConfirm();
    // The description carries the alert's title, its TYPE label
    // («مخزون منخفض» — TYPE_META.low_stock), and its message.
    expect(dialog.getByText(/مخزون Netflix منخفض/)).toBeInTheDocument();
    expect(dialog.getByText(/مخزون منخفض/)).toBeInTheDocument();
    expect(dialog.getByText(/بقي 3 وحدات فقط/)).toBeInTheDocument();
    expect(dialog.getByText(/لا يمكن التراجع/)).toBeInTheDocument();
    // Destructive treatment on the confirm action.
    expect(dialog.getByRole("button", { name: "حذف" })).toBeInTheDocument();
  });

  it("cancel performs NO delete request", async () => {
    fetchMock.mockResolvedValue(resLike());
    renderPage();

    const dialog = await openDeleteConfirm();
    fireEvent.click(dialog.getByRole("button", { name: "إلغاء" }));

    await waitFor(() => expect(screen.queryByText("حذف التنبيه؟")).not.toBeInTheDocument());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("confirm fires the DELETE for exactly that alert id", async () => {
    fetchMock.mockResolvedValue(resLike({ body: { success: true } }));
    renderPage();

    const dialog = await openDeleteConfirm();
    fireEvent.click(dialog.getByRole("button", { name: "حذف" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/admin/alerts/7");
    expect(init.method).toBe("DELETE");
  });
});
