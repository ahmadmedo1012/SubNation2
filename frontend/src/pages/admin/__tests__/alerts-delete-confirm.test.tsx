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
 * R125 additions (A6 B-2/B-15 + A3 #6/A6 B-10):
 *
 *   4. The row action cluster reveals on keyboard focus
 *      (sm:group-focus-within — jsdom cannot compute :focus-within, so
 *      the pin is the class contract on the cluster container).
 *   5. Both filter chip bars expose aria-pressed.
 *   6. system + forecast_stockout rows are filterable (the FILTERS
 *      list now covers every TYPE_META type).
 *   7. حذف الكل rides the SAME shared confirm (naming the count) —
 *      the inline «نعم / لا» block is gone.
 *   8. Unread rows carry an sr-only cue; read rows are no longer
 *      dimmed below text-contrast floors.
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
import {
  deleteAdminAlert,
  deleteAllAdminAlerts,
  listAdminAlerts,
} from "@workspace/api-client-react";

// R126-L8b (A4 §C batch-C): the page rides the generated fetchers from
// the batch-1 spec exposure — the mock follows the new module surface
// (listAdminAlerts for the inbox query; deleteAdminAlert /
// deleteAllAdminAlerts for the two confirm-pinned destructive actions).
vi.mock("@workspace/api-client-react", () => ({
  listAdminAlerts: vi.fn(),
  markAdminAlertRead: vi.fn(),
  markAllAdminAlertsRead: vi.fn(),
  deleteAdminAlert: vi.fn(),
  deleteReadAdminAlerts: vi.fn(),
  deleteAllAdminAlerts: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    data: unknown;
    constructor(message: string, status: number, data: unknown = null) {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.data = data;
    }
  },
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
    (listAdminAlerts as unknown as Mock).mockResolvedValue(PAGE_ONE);
    (deleteAdminAlert as unknown as Mock).mockResolvedValue({ success: true });
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
    renderPage();

    const dialog = await openDeleteConfirm();
    fireEvent.click(dialog.getByRole("button", { name: "إلغاء" }));

    await waitFor(() => expect(screen.queryByText("حذف التنبيه؟")).not.toBeInTheDocument());
    // R126-L8b: the DELETE is the generated fetcher now — the pin is the
    // fetcher call, not the raw fetch URL.
    expect(deleteAdminAlert).not.toHaveBeenCalled();
  });

  it("confirm fires the DELETE for exactly that alert id", async () => {
    renderPage();

    const dialog = await openDeleteConfirm();
    fireEvent.click(dialog.getByRole("button", { name: "حذف" }));

    await waitFor(() => expect(deleteAdminAlert).toHaveBeenCalledTimes(1));
    expect((deleteAdminAlert as unknown as Mock).mock.calls[0][0]).toBe(7);
  });
});

/** R125 (A3 #6): every TYPE_META type present — system + forecast_stockout
 *  were rendered but unfilterable before the FILTERS completion. */
const PAGE_TYPES = {
  alerts: [
    {
      id: 11,
      type: "low_stock" as const,
      title: "مخزون Netflix منخفض",
      message: "بقي 3 وحدات فقط",
      isRead: true,
      createdAt: "2026-09-08T10:00:00.000Z",
    },
    {
      id: 12,
      type: "system" as const,
      title: "صيانة مجدولة الليلة",
      message: "قد يتوقف النظام لعدة دقائق",
      isRead: false,
      createdAt: "2026-09-08T11:00:00.000Z",
    },
    {
      id: 13,
      type: "forecast_stockout" as const,
      title: "نفاد متوقع لـ Spotify",
      message: "خلال يومين وفق معدل البيع",
      isRead: false,
      createdAt: "2026-09-08T12:00:00.000Z",
    },
  ],
  unreadCount: 2,
  total: 3,
  page: 1,
  limit: 50,
  hasMore: false,
};

describe("AdminAlertsPage — row actions visible to keyboard focus (R125 A6 B-2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (listAdminAlerts as unknown as Mock).mockResolvedValue(PAGE_ONE);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("the action cluster carries the focus-within reveal class alongside hover", async () => {
    renderPage();
    await screen.findByText("مخزون Netflix منخفض");

    const deleteBtn = screen.getByTitle("حذف");
    const cluster = deleteBtn.closest("div");
    expect(cluster).not.toBeNull();
    // jsdom cannot compute :focus-within — the class contract is the
    // pin: the cluster stays opacity-0 on ≥sm until hover OR focus.
    expect(cluster!.className).toContain("sm:group-hover:opacity-100");
    expect(cluster!.className).toContain("sm:group-focus-within:opacity-100");
    // …and the buttons remain reachable (never display:none).
    expect(cluster!.className).not.toContain("hidden");
  });
});

describe("AdminAlertsPage — chip bars expose toggle state + every type filters (R125 A3 #6 / A6 B-10)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (listAdminAlerts as unknown as Mock).mockResolvedValue(PAGE_TYPES);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("both filter bars carry aria-pressed matching the active filter", async () => {
    renderPage();
    await screen.findByText("صيانة مجدولة الليلة");

    // «الكل» is the active filter on load — pressed on both bars…
    expect(screen.getByRole("button", { name: /^الكل/ })).toHaveAttribute("aria-pressed", "true");
    // …and a type chip («مخزون منخفض» appears in BOTH the stats row and
    // the tab bar with a count) is not.
    const lowStockChips = screen.getAllByRole("button", { name: /مخزون منخفض/ });
    expect(lowStockChips.length).toBeGreaterThanOrEqual(2);
    for (const chip of lowStockChips) expect(chip).toHaveAttribute("aria-pressed", "false");

    // Clicking either bar's chip flips BOTH bars' state (one source).
    fireEvent.click(lowStockChips[0]);
    for (const chip of screen.getAllByRole("button", { name: /مخزون منخفض/ })) {
      expect(chip).toHaveAttribute("aria-pressed", "true");
    }
    expect(screen.getByRole("button", { name: /^الكل/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("system alerts are filterable (previously rendered but unfilterable)", async () => {
    renderPage();
    await screen.findByText("صيانة مجدولة الليلة");

    // The «نظام» filter exists in the tab bar…
    const systemChips = screen.getAllByRole("button", { name: /نظام/ });
    expect(systemChips.length).toBeGreaterThanOrEqual(1);

    // …and clicking it narrows the list to the system row only.
    fireEvent.click(systemChips[0]);
    expect(screen.getByText("صيانة مجدولة الليلة")).toBeInTheDocument();
    expect(screen.queryByText("مخزون Netflix منخفض")).not.toBeInTheDocument();
    expect(screen.queryByText("نفاد متوقع لـ Spotify")).not.toBeInTheDocument();
  });

  it("forecast_stockout alerts are filterable", async () => {
    renderPage();
    await screen.findByText("نفاد متوقع لـ Spotify");

    const forecastChips = screen.getAllByRole("button", { name: /نفاد متوقع/ });
    expect(forecastChips.length).toBeGreaterThanOrEqual(1);

    fireEvent.click(forecastChips[0]);
    expect(screen.getByText("نفاد متوقع لـ Spotify")).toBeInTheDocument();
    expect(screen.queryByText("صيانة مجدولة الليلة")).not.toBeInTheDocument();
  });
});

describe("AdminAlertsPage — حذف الكل rides the shared confirm (R125 A3 #6)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (listAdminAlerts as unknown as Mock).mockResolvedValue(PAGE_TYPES);
    (deleteAllAdminAlerts as unknown as Mock).mockResolvedValue({ success: true });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Opens the delete-all confirm and returns the scoped dialog. */
  async function openDeleteAllConfirm() {
    await screen.findByText("صيانة مجدولة الليلة");
    fireEvent.click(screen.getByRole("button", { name: "حذف الكل" }));

    const title = await screen.findByText("حذف كل التنبيهات؟");
    const dialog = title.closest('[role="alertdialog"]');
    if (!dialog) throw new Error("delete-all confirm dialog not rendered");
    return within(dialog as HTMLElement);
  }

  it("opens the shared confirm naming the count — no inline نعم/لا block", async () => {
    renderPage();
    const dialog = await openDeleteAllConfirm();

    // The description names the count (server total = 3) and that BOTH
    // read and unread alerts go — the clarify-rule copy the inline
    // «تأكيد حذف الكل؟ نعم / لا» block never carried.
    expect(dialog.getByText(/3 تنبيهات/)).toBeInTheDocument();
    expect(dialog.getByText(/المقروءة وغير المقروءة/)).toBeInTheDocument();
    expect(dialog.getByText(/لا يمكن التراجع/)).toBeInTheDocument();
    expect(dialog.getByRole("button", { name: "حذف الكل" })).toBeInTheDocument();
    // The inline block is gone entirely.
    expect(screen.queryByText("تأكيد حذف الكل؟")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "نعم" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "لا" })).not.toBeInTheDocument();
  });

  it("cancel performs NO delete-all request", async () => {
    renderPage();
    const dialog = await openDeleteAllConfirm();

    fireEvent.click(dialog.getByRole("button", { name: "إلغاء" }));
    await waitFor(() => expect(screen.queryByText("حذف كل التنبيهات؟")).not.toBeInTheDocument());
    // R126-L8b: the DELETE is the generated fetcher now.
    expect(deleteAllAdminAlerts).not.toHaveBeenCalled();
  });

  it("confirm fires the DELETE for the whole inbox", async () => {
    renderPage();
    const dialog = await openDeleteAllConfirm();

    fireEvent.click(dialog.getByRole("button", { name: "حذف الكل" }));

    await waitFor(() => expect(deleteAllAdminAlerts).toHaveBeenCalledTimes(1));
  });
});

describe("AdminAlertsPage — read/unread state is not color-only (R125 A6 B-15)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (listAdminAlerts as unknown as Mock).mockResolvedValue(PAGE_TYPES);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("unread rows carry an sr-only «غير مقروء» cue", async () => {
    renderPage();
    await screen.findByText("صيانة مجدولة الليلة");

    const cues = screen
      .getAllByText("غير مقروء", { exact: false })
      .filter((el) => el.classList.contains("sr-only"));
    // Two unread rows in the fixture → two sr-only cues.
    expect(cues).toHaveLength(2);
  });

  it("read rows are distinguished by surface only — no opacity dimming below text contrast", async () => {
    renderPage();
    await screen.findByText("مخزون Netflix منخفض");

    const readRow = screen.getByText("مخزون Netflix منخفض").closest(".group");
    expect(readRow).not.toBeNull();
    expect(readRow!.className).not.toContain("opacity-60");
    // The read-state surface IS what marks the row…
    expect(readRow!.className).toContain("bg-card/40");
    // …while unread rows keep their elevated surface.
    const unreadRow = screen.getByText("صيانة مجدولة الليلة").closest(".group");
    expect(unreadRow!.className).toContain("bg-card");
    expect(unreadRow!.className).not.toContain("bg-card/40");
  });
});
