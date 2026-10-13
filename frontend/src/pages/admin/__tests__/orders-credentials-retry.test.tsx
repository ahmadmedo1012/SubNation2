/**
 * D-2 (R142) — the admin orders credentials-on-demand failure path.
 *
 * ensureOrderCredentials remembered a failed GET /api/admin/orders/:id/
 * credentials for the PAGE's lifetime, while its own failure toast told
 * the operator «حاول فتح الطلب مرة أخرى» — the exact retry the guard
 * made a no-op (collapse + re-expand hit the early return; only a full
 * reload recovered, which nothing disclosed). The fix: COLLAPSING the
 * row forgets the failure, so the next expansion re-fires the audited
 * fetch — the toast's instruction becomes honest, and the B6-03
 * retry-spam guard stays armed while the row is open.
 *
 * Harness: the orders-bulk-status.test.tsx idiom (module-boundary mocks
 * for the generated client + the admin shell; the credentials GET rides
 * the stubbed global fetch).
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

const ORDER_WITH_CREDS = {
  id: 1024,
  order_code: "SN-1024",
  user_phone: "0912345678",
  product_name: "Netflix 1M",
  amount: 25,
  status: "completed",
  created_at: "2026-09-01T10:00:00.000Z",
  has_credentials: true,
};

/** Minimal Response-like object — the page reads .ok/.status/.json(). */
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

/** The DESKTOP row's expand toggle (the mobile card twin renders too —
 *  index 0 is the desktop table's, which precedes the card list). */
async function expandToggle(open: boolean): Promise<HTMLElement> {
  const name = open ? "إخفاء بيانات تسليم الطلب SN-1024" : "عرض بيانات تسليم الطلب SN-1024";
  const buttons = await screen.findAllByRole("button", { name });
  // The DESKTOP table renders before the mobile card list, so index 0
  // is the desktop row's toggle (both toggle the same expandedRow).
  return buttons[0];
}

function credentialsCalls(): number {
  return fetchMock.mock.calls.filter(([url]) =>
    String(url).includes("/api/admin/orders/1024/credentials"),
  ).length;
}

beforeEach(() => {
  vi.clearAllMocks();
  (listAdminOrders as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([ORDER_WITH_CREDS]);
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AdminOrdersPage — credentials failure is forgotten on collapse (D-2)", () => {
  it("collapse + re-expand re-fires the audited fetch — the toast's «حاول فتح الطلب مرة أخرى» is honest now", async () => {
    // Every credentials GET answers 502 (a transient proxy blip).
    fetchMock.mockImplementation((url: unknown) =>
      String(url).includes("/credentials")
        ? Promise.resolve(resLike({ ok: false, status: 502, body: { error: "bad gateway" } }))
        : Promise.resolve(resLike({ body: [] })),
    );
    renderPage();

    // Expand #1 → the fetch fires and FAILS (the desktop toggle; the
    // mobile card twin renders its own — index 0 is the desktop table's).
    fireEvent.click(await expandToggle(false));
    await waitFor(() => expect(credentialsCalls()).toBe(1));
    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ title: "تعذّر تحميل بيانات التسليم" }),
      ),
    );
    // The honest red line (not a silent empty expansion) — desktop row
    // AND the mobile card twin both render it.
    expect((await screen.findAllByText("تعذّر تحميل بيانات التسليم")).length).toBeGreaterThan(0);

    // Collapse…
    fireEvent.click(await expandToggle(true));
    await waitFor(() =>
      expect(screen.queryByText("تعذّر تحميل بيانات التسليم")).not.toBeInTheDocument(),
    );

    // …re-expand — the PRE-fix code no-op'd here (sticky failure set);
    // now the retry actually re-fires the request.
    fireEvent.click(await expandToggle(false));
    await waitFor(() => expect(credentialsCalls()).toBe(2));
    // One toast per FAILED attempt (not per effect re-run — the
    // in-flight/failed guards stay armed while the row is open).
    expect(toastMock).toHaveBeenCalledTimes(2);
  });

  it("while the row STAYS open, a failure is not re-fetched on unrelated re-renders (B6-03 guard intact)", async () => {
    fetchMock.mockImplementation((url: unknown) =>
      String(url).includes("/credentials")
        ? Promise.resolve(resLike({ ok: false, status: 502, body: { error: "bad gateway" } }))
        : Promise.resolve(resLike({ body: [] })),
    );
    renderPage();

    fireEvent.click(await expandToggle(false));
    await waitFor(() => expect(credentialsCalls()).toBe(1));
    await waitFor(() =>
      expect(screen.getAllByText("تعذّر تحميل بيانات التسليم").length).toBeGreaterThan(0),
    );

    // A keystroke in the search box re-renders the page (and re-runs the
    // expand effect via ensureOrderCredentials identity churn) — the
    // remembered failure still suppresses retry spam while the row is open.
    fireEvent.change(screen.getByPlaceholderText(/بحث/), { target: { value: "SN-1" } });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(credentialsCalls()).toBe(1);
  });
});
