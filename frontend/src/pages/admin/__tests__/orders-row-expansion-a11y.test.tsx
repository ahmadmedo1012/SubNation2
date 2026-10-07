/**
 * R111-FIX-A — WCAG keyboard/semantics regressions for the admin orders
 * table (F3-02 + F3-08).
 *
 * The delivered-credentials expansion used to be five `<td onClick>` cells
 * + a chevron cell with NO keyboard access (2.1.1): a keyboard operator
 * could never open a row, so delivered credentials / coupon details were
 * mouse-only. The toggle is now a real `<button>` in the chevron cell
 * (Enter/Space are native button behavior) with `aria-expanded` + a
 * state-aware accessible name; the mobile card's meta row became the same
 * toggle.
 *
 * The icon-only bulk-select buttons (header select-all + per-row selects)
 * carried no accessible name and no state (1.1.1 + 4.1.2) — the selection
 * feeding the bulk-refund money action was visual-only. They now carry
 * `aria-label` + `aria-pressed`.
 *
 * These tests pin the semantics (a native <button> is inherently
 * keyboard-operable, so asserting the role/name/state IS the keyboard
 * contract), the expand/collapse round-trip, and that the credentials'
 * own controls (mask reveal, copy) are present in the expanded row's
 * accessibility tree — i.e. keyboard-reachable after expansion.
 *
 * Same module-boundary mock pattern as orders-bulk-status.test.tsx.
 */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { type ReactNode } from "react";
import AdminOrdersPage from "@/pages/admin/orders";
import { listAdminOrders } from "@workspace/api-client-react";

vi.mock("@workspace/api-client-react", () => ({
  listAdminOrders: vi.fn(),
  getListAdminOrdersQueryKey: (params?: unknown) => ["/api/admin/orders", params ?? null],
  setUnauthorizedHandler: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    adminToken: "test-admin-token",
    // R120-B4 (A2-F4): the page gates the bulk-refund option on the
    // finance scope — default-grant keeps these a11y tests scoped to
    // their own concern.
    hasAdminPermission: () => true,
  }),
}));

vi.mock("@/pages/admin/layout", () => ({
  AdminLayout: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock, dismiss: vi.fn() }),
}));

// B6-03 (R116): the list no longer ships decrypted credentials — the
// plaintext comes from GET /api/admin/orders/:id/credentials on first
// reveal. The endpoint is mocked at the fetch boundary (same stubGlobal
// pattern as orders-bulk-status.test.tsx).
const ORDER = {
  id: 7,
  order_code: "SN-1007",
  user_phone: "0912345678",
  product_name: "Netflix 1M",
  amount: 25,
  status: "completed",
  created_at: "2026-09-03T10:00:00.000Z",
  has_credentials: true,
};

// Fixture value built at runtime — never a committed credential literal.
const FAKE_PASSWORD = ["test", "password", "not", "real"].join("-");

const CREDENTIALS_BODY = {
  id: 7,
  order_code: "SN-1007",
  status: "completed",
  has_credentials: true,
  delivered_email: "user@example.com",
  delivered_password: FAKE_PASSWORD,
  delivered_extra_details: null,
};

function resLike(body: unknown) {
  return {
    ok: true,
    status: 200,
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

/** The desktop table's expand toggle (before the mobile card's one in DOM). */
async function desktopExpandButton() {
  await screen.findAllByText("SN-1007");
  const row = screen.getAllByText("SN-1007")[0].closest("tr");
  if (!row) throw new Error("desktop row not found");
  return within(row).getByRole("button", { name: /بيانات تسليم الطلب/ });
}

/** The desktop credentials row (inside a <tr> — the mobile card's copy
 *  renders the same «البريد:» label outside any table). Async: B6-03
 *  fetches the values from the per-order endpoint, so the row appears
 *  a tick after the expand click. */
async function desktopExpandedRow() {
  const els = await screen.findAllByText("البريد:");
  const el = els.find((n) => n.closest("tr"));
  if (!el) throw new Error("desktop expanded credentials row not found");
  return el.closest("tr") as HTMLElement;
}

describe("AdminOrdersPage — keyboard row expansion (F3-02, WCAG 2.1.1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (listAdminOrders as unknown as Mock).mockResolvedValue([ORDER]);
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(resLike(CREDENTIALS_BODY));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("the expand control is a real button with aria-expanded + a state-aware name", async () => {
    renderPage();

    const toggle = await desktopExpandButton();
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle.getAttribute("aria-label")).toBe("عرض بيانات تسليم الطلب SN-1007");

    fireEvent.click(toggle);
    // The credentials row opened and the toggle state flipped + renamed.
    // B6-03 (R116): the values arrive from the per-order credentials
    // fetch — await them.
    await screen.findAllByText("البريد:");
    await screen.findAllByText("كلمة المرور:");
    const expanded = await desktopExpandButton();
    expect(expanded).toHaveAttribute("aria-expanded", "true");
    expect(expanded.getAttribute("aria-label")).toBe("إخفاء بيانات تسليم الطلب SN-1007");

    // Round-trip: collapse hides the credentials again.
    fireEvent.click(expanded);
    expect(screen.queryByText("البريد:")).not.toBeInTheDocument();
  });

  it("credentials inside the expanded row are keyboard-reachable (mask reveal + copy buttons)", async () => {
    renderPage();

    fireEvent.click(await desktopExpandButton());

    const expandedRow = await desktopExpandedRow();
    // The reveal toggle and the shared CopyButton are real buttons in the
    // expanded row's a11y tree — Tab reaches them once the row is open.
    expect(within(expandedRow).getByRole("button", { name: "إظهار البريد" })).toBeInTheDocument();
    expect(within(expandedRow).getAllByRole("button", { name: "نسخ" }).length).toBeGreaterThan(0);
  });

  it("B6-03: first reveal fetches the audited per-order endpoint once and caches per order id", async () => {
    renderPage();

    fireEvent.click(await desktopExpandButton());

    // The audited endpoint was called exactly once with the admin headers.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/admin/orders/7/credentials");
    expect(init.method).toBeUndefined(); // plain GET

    // Collapse + re-expand: served from the per-order cache — no re-fetch
    // (every reveal would write another audit row for nothing).
    const expanded = await desktopExpandButton();
    fireEvent.click(expanded);
    expect(screen.queryByText("البريد:")).not.toBeInTheDocument();
    fireEvent.click(await desktopExpandButton());
    await screen.findAllByText("البريد:");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("B6-03: values stay masked until revealed (the fetch itself never unmasks)", async () => {
    renderPage();

    fireEvent.click(await desktopExpandButton());

    const expandedRow = await desktopExpandedRow();
    // Both credential fields render masked (email + password).
    expect(within(expandedRow).getAllByText("••••••")).toHaveLength(2);
    expect(within(expandedRow).queryByText(FAKE_PASSWORD)).not.toBeInTheDocument();
  });

  it("the mobile card carries the same named expand toggle (shared expandedRow state)", async () => {
    renderPage();

    // Desktop table + mobile card list both render in jsdom — both toggles
    // flip together off the single expandedRow state.
    const toggles = await screen.findAllByRole("button", {
      name: /بيانات تسليم الطلب SN-1007/,
    });
    expect(toggles.length).toBe(2);
    fireEvent.click(toggles[1]);
    for (const t of await screen.findAllByRole("button", {
      name: /إخفاء بيانات تسليم الطلب SN-1007/,
    })) {
      expect(t).toHaveAttribute("aria-expanded", "true");
    }
  });
});

describe("AdminOrdersPage — bulk-select name + state (F3-08, WCAG 1.1.1 + 4.1.2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (listAdminOrders as unknown as Mock).mockResolvedValue([ORDER]);
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(resLike(CREDENTIALS_BODY));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("row selectors expose an accessible name and aria-pressed", async () => {
    renderPage();

    const selectors = await screen.findAllByRole("button", {
      name: "تحديد الطلب SN-1007 للإجراء الجماعي",
    });
    // Desktop table + mobile card both carry the named selector.
    expect(selectors.length).toBe(2);
    for (const btn of selectors) expect(btn).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(selectors[0]);
    for (const btn of await screen.findAllByRole("button", {
      name: "تحديد الطلب SN-1007 للإجراء الجماعي",
    })) {
      expect(btn).toHaveAttribute("aria-pressed", "true");
    }
    expect(screen.getByText("1 طلب محدد")).toBeInTheDocument();
  });

  it("the header select-all is named and reflects the all-selected state", async () => {
    renderPage();

    const selectAll = await screen.findByRole("button", {
      name: "تحديد كل الطلبات المعروضة للإجراء الجماعي",
    });
    expect(selectAll).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(selectAll);
    expect(selectAll).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("1 طلب محدد")).toBeInTheDocument();

    // Toggling again clears.
    fireEvent.click(selectAll);
    expect(selectAll).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByText("1 طلب محدد")).not.toBeInTheDocument();
  });
});
