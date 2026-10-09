/**
 * 94-C2 (A2 P1-1 + P2-11) — alerts inbox pagination + silent-failure
 * tests.
 *
 * Two defects pinned:
 *
 *   1. (P1-1) The inbox loaded ONE silent 50-row window while the
 *      footer claimed «N تنبيه إجمالاً» — 300+ accumulated alerts
 *      were unreachable. Now the inbox is an accumulating
 *      useInfiniteQuery over the frozen `?page=&limit=` contract
 *      (server `hasMore`/`total` honored): «تحميل المزيد» appends in
 *      place, hides at the end, and the footer says «عرض N من TOTAL».
 *
 *   2. (P2-11) The delete/read mutations had NO r.ok check — a failed
 *      DELETE "succeeded" (fetch resolves on HTTP errors),
 *      invalidated the cache, and silently resurrected the rows. Now
 *      every failure surfaces as a destructive toast.
 *
 * `@workspace/api-client-react`, `@/lib/auth`, the admin shell and the
 * toast hook are mocked at the module boundary (vitest-config pattern).
 */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { beforeEach, afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { type ReactNode } from "react";
import AdminAlertsPage from "@/pages/admin/alerts";
import {
  deleteReadAdminAlerts,
  listAdminAlerts,
  markAdminAlertRead,
} from "@workspace/api-client-react";

// R126-L8b (A4 §C batch-C): the page rides the generated fetchers from
// the batch-1 spec exposure — the mock follows the new module surface
// (listAdminAlerts for the accumulating inbox query; the mutation
// fetchers for the five row/bulk actions). ApiError is the mock's own
// class so the page's `err instanceof ApiError && err.status === 401`
// quiet-catch stays instanceof-compatible and the failure paths can
// construct realistic 5xx rejections.
const { ApiErrorMock } = vi.hoisted(() => {
  class ApiErrorMock extends Error {
    status: number;
    data: unknown;
    constructor(message: string, status: number, data: unknown = null) {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.data = data;
    }
  }
  return { ApiErrorMock };
});

vi.mock("@workspace/api-client-react", () => ({
  listAdminAlerts: vi.fn(),
  markAdminAlertRead: vi.fn(),
  markAllAdminAlertsRead: vi.fn(),
  deleteAdminAlert: vi.fn(),
  deleteReadAdminAlerts: vi.fn(),
  deleteAllAdminAlerts: vi.fn(),
  ApiError: ApiErrorMock,
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

const ALERT = (i: number, isRead = false) => ({
  id: i,
  type: i % 2 === 0 ? "low_stock" : "no_stock",
  title: `تنبيه رقم ${i}`,
  message: null,
  isRead,
  createdAt: "2026-09-08T10:00:00.000Z",
});

/** 30 unread + 20 read = a full 50-row page with a server-known total. */
const PAGE_ONE = {
  alerts: [
    ...Array.from({ length: 30 }, (_, i) => ALERT(i, false)),
    ...Array.from({ length: 20 }, (_, i) => ALERT(100 + i, true)),
  ],
  unreadCount: 30,
  total: 62,
  page: 1,
  limit: 50,
  hasMore: true,
};

const PAGE_TWO = {
  alerts: Array.from({ length: 12 }, (_, i) => ALERT(200 + i, false)),
  unreadCount: 42,
  total: 62,
  page: 2,
  limit: 50,
  hasMore: false,
};

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

describe("AdminAlertsPage — accumulating load-more + honest counts (A2 P1-1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("a full page with hasMore offers تحميل المزيد; page 2 appends in place and ends the list", async () => {
    (listAdminAlerts as unknown as Mock)
      .mockResolvedValueOnce(PAGE_ONE)
      .mockResolvedValueOnce(PAGE_TWO);

    renderPage();

    await screen.findAllByText("تنبيه رقم 0");
    // Honest footer: «عرض 50 … من 62» — never «إجمالاً» over a
    // truncated window.
    expect(screen.getByText(/عرض 50/)).toBeInTheDocument();
    expect(screen.getByText(/من 62/)).toBeInTheDocument();
    expect(screen.queryByText(/إجمالاً/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "تحميل المزيد" }));

    // The frozen contract: page 2 of the same limit (the generated
    // fetcher builds `?page=2&limit=50` from these typed params).
    await screen.findAllByText("تنبيه رقم 200");
    expect((listAdminAlerts as unknown as Mock).mock.calls[1][0]).toEqual({
      page: 2,
      limit: 50,
    });
    // Page-1 rows survive the load-more (append, not swap).
    expect(screen.getAllByText("تنبيه رقم 0").length).toBeGreaterThan(0);

    // hasMore=false — the definite end.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "تحميل المزيد" })).not.toBeInTheDocument(),
    );
    // 50 + 12 = 62 = total — the whole inbox is on screen now.
    expect(screen.getByText(/عرض 62/)).toBeInTheDocument();
  });

  it("a short single page shows no load-more (the server said that's all)", async () => {
    (listAdminAlerts as unknown as Mock).mockResolvedValue({
      ...PAGE_ONE,
      alerts: PAGE_ONE.alerts.slice(0, 5),
      total: 5,
      hasMore: false,
    });

    renderPage();

    await screen.findAllByText("تنبيه رقم 0");
    expect(screen.queryByRole("button", { name: "تحميل المزيد" })).not.toBeInTheDocument();
  });
});

describe("AdminAlertsPage — mutations surface failures instead of silently resurrecting rows (A2 P2-11)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (listAdminAlerts as unknown as Mock).mockResolvedValue(PAGE_ONE);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("a FAILED delete-read toasts the error after the confirm (was: one-tap + silent)", async () => {
    // R126-L8b: the generated fetcher rejects with customFetch's ApiError
    // (status + parsed envelope on .data) — getErrorMessage picks the
    // Arabic server message out of it, exactly like the adminFetchJson
    // path it replaced. The real ApiError is a type-only re-export, so
    // the rejection value is the mock's own hoisted class (what the
    // mocked module actually serves — instanceof-exact).
    (deleteReadAdminAlerts as unknown as Mock).mockRejectedValue(
      new ApiErrorMock("HTTP 500 Internal Server Error", 500, {
        error: "خطأ في الخادم",
        code: "INTERNAL_ERROR",
      }),
    );

    renderPage();

    const btn = await screen.findByRole("button", { name: /حذف المقروءة/ });
    fireEvent.click(btn);

    // R123 (E3 item 3): «حذف المقروءة» now routes through the mounted
    // styled confirm (it was the last one-tap destructive bulk action on
    // the page) — the dialog names the read-count the button itself
    // displays (PAGE_ONE carries 20 read rows).
    const title = await screen.findByText("حذف التنبيهات المقروءة؟");
    const dialog = title.closest('[role="alertdialog"]');
    if (!dialog) throw new Error("delete-read confirm dialog not rendered");
    expect((dialog as HTMLElement).textContent).toContain("20");
    fireEvent.click(within(dialog as HTMLElement).getByRole("button", { name: "حذف" }));

    await waitFor(() => expect(toastMock).toHaveBeenCalledTimes(1));
    const toastArg = toastMock.mock.calls[0][0];
    expect(toastArg.title).toBe("فشل حذف التنبيهات المقروءة");
    expect(String(toastArg.description)).toContain("خطأ في الخادم");
    expect(toastArg.variant).toBe("destructive");
  });

  it("a FAILED mark-read rolls the optimistic dot back and toasts (was: silent)", async () => {
    (markAdminAlertRead as unknown as Mock).mockRejectedValue(
      new ApiErrorMock("HTTP 500 Internal Server Error", 500, {
        error: "خطأ في الخادم",
        code: "INTERNAL_ERROR",
      }),
    );

    renderPage();

    // Clicking an unread alert row marks it read (optimistic).
    const row = await screen.findByText("تنبيه رقم 1");
    fireEvent.click(row.closest("div.group") ?? row);

    await waitFor(() => expect(toastMock).toHaveBeenCalledTimes(1));
    const toastArg = toastMock.mock.calls[0][0];
    expect(toastArg.title).toBe("فشل تعيين التنبيه كمقروء");
    expect(toastArg.variant).toBe("destructive");
  });
});
