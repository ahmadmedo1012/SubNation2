/**
 * R125-I4 (A4-B-3) + A10 §C-5 — admin-stats co-invalidation tests for
 * the users/tickets mutation families.
 *
 * `admin-stats-update` is emitted by the backend ONLY for orders bulk
 * + topup approve/reject (routes/admin/orders.ts, topup.service.ts),
 * and /admin/stats has no write-side cache invalidation (30s server
 * cache, stats.ts:129-133) — so these admin mutations changed
 * stats-consumed numbers while the dashboard/layout stayed stale for
 * up to 300s:
 *
 *   - users wallet/points save → total_wallet_balance changes
 *     (only the users list key was invalidated).
 *   - tickets status flip → open_tickets changes (the layout badge
 *     prefers the server number; closing a ticket left it lagging
 *     ≤5min).
 *
 * The socket-emit half for these routes is I6's (backend); this file
 * pins the FRONTEND half — the mutation success paths must also
 * invalidate the shared stats query key (the same refresh the
 * `admin-stats-update` socket push performs,
 * SocketInitializer.tsx:82).
 *
 * Method: a real QueryClient per render (retry: false) with
 * invalidateQueries spied (the resync-test key-spy idiom), then the
 * mutation is driven through the real UI and the exact stats key is
 * asserted.
 *
 * (The A10 §C-5 row also names products create/update/delete —
 * another lane's file; covered there.)
 *
 * `@workspace/api-client-react` (users arm), `@/lib/auth`, the admin
 * shell and the toast hook are mocked at the module boundary
 * (vitest-config pattern).
 */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { beforeEach, afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { type ReactNode } from "react";
import AdminUsersPage from "@/pages/admin/users";
import AdminTicketsPage from "@/pages/admin/tickets";
import { customFetch } from "@workspace/api-client-react";

vi.mock("@workspace/api-client-react", () => ({
  // The users directory rides a useInfiniteQuery over customFetch —
  // the mock follows the module surface the page graph imports (the
  // tickets page does not use it).
  customFetch: vi.fn(),
  getListAdminUsersQueryKey: (params?: unknown) => ["/api/admin/users", params ?? null],
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

/** Renders with a fresh client whose invalidateQueries is spied. */
function renderSpied(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const spy = vi.spyOn(client, "invalidateQueries");
  return {
    spy,
    ...render(
      <QueryClientProvider client={client}>
        <Router>{ui}</Router>
      </QueryClientProvider>,
    ),
  };
}

describe("users — a wallet save also invalidates the shared admin-stats key (A4-B-3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (customFetch as unknown as Mock).mockResolvedValue([USER]);
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(resLike({ body: { id: 16, wallet_balance: 175 } }));
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(null, "", "/admin/users");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('the wallet PATCH success path invalidates ["/api/admin/stats"] alongside the users key', async () => {
    const { spy } = renderSpied(<AdminUsersPage />);

    // Open the edit dialog (the rows land asynchronously).
    const editButtons = await screen.findAllByRole("button", {
      name: /تعديل المستخدم 0913456789/,
    });
    fireEvent.click(editButtons[0]);
    const dialog = await screen.findByRole("dialog");

    // A wallet amount + a valid note (the money gates).
    fireEvent.change(within(dialog).getByPlaceholderText("المبلغ للإضافة"), {
      target: { value: "25" },
    });
    fireEvent.change(within(dialog).getByPlaceholderText("سبب التعديل (3 أحرف على الأقل)"), {
      target: { value: "تسوية رصيد إدارية" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ" }));

    // The money-confirm dialog, then execute.
    const confirmTitle = await screen.findByText("تأكيد تعديل المحفظة");
    const confirmDialog = confirmTitle.closest('[role="alertdialog"]') as HTMLElement;
    fireEvent.click(within(confirmDialog).getByRole("button", { name: "تنفيذ التعديل" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    // The stats key — the exact key the admin-stats-update socket
    // push invalidates (SocketInitializer.tsx:82).
    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith({ queryKey: ["/api/admin/stats"] });
    });
    // …and the users base key still refreshes (the pre-existing half).
    expect(spy).toHaveBeenCalledWith({ queryKey: ["/api/admin/users", null] });
  });
});

describe("tickets — a status flip also invalidates the shared admin-stats key (A4-B-3)", () => {
  const ticketSummary = {
    id: 1,
    user_phone: "0911111111",
    user_display_name: null,
    user_email: null,
    user_auth_provider: null,
    title: "مشكلة في الشحن",
    category: "billing",
    status: "open",
    created_at: "2026-09-01T10:00:00.000Z",
    reply_count: 1,
    last_reply_at: "2026-09-01T11:00:00.000Z",
    has_unread_admin: true,
  };
  const ticketDetail = {
    ...ticketSummary,
    replies: [
      { id: 1, author_type: "user", message: "أين طلبي؟", created_at: "2026-09-01T11:00:00.000Z" },
    ],
  };

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "PATCH") return resLike({ body: { ok: true } });
      if (url === "/api/admin/tickets/1") return resLike({ body: ticketDetail });
      return resLike({ body: [ticketSummary] });
    });
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(null, "", "/admin/tickets");
    // jsdom does not implement scrollIntoView — the detail pane's
    // scroll-to-bottom effect fires once a ticket opens.
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('closing a ticket invalidates ["/api/admin/stats"] (open_tickets feeds the layout badge)', async () => {
    const { spy } = renderSpied(<AdminTicketsPage />);

    const card = await screen.findByText("مشكلة في الشحن");
    fireEvent.click(card.closest("button")!);

    // The detail pane header carries the close action.
    const close = await screen.findByRole("button", { name: "إغلاق" });
    fireEvent.click(close);

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          (c) =>
            String(c[0]) === "/api/admin/tickets/1/status" &&
            (c[1] as RequestInit).method === "PATCH",
        ),
      ).toBe(true);
    });
    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith({ queryKey: ["/api/admin/stats"] });
    });
  });
});
