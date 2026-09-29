/**
 * 98-F7 (R98-06 — A5 §2) — AdminLayout unread-alerts badge honesty tests.
 *
 * The badge query did `.then((r) => r.json())` with NO r.ok check and a
 * hand-built `Authorization: adminToken ? … : ""` header: a 401/500/503
 * error envelope parsed "successfully" into {error,code}, `.count` was
 * undefined, and the `?? 0` fallback rendered a **0 badge** — the badge
 * actively lied "all clear" while the alerts API was down. Same class
 * as the false-empty states killed on every page in earlier rounds.
 *
 * These tests pin the new contract:
 *
 *   1. Non-OK (401/500/503) ⇒ query error state ⇒ NO badge rendered
 *      (mergedBadges.unreadAlerts falls back to 0 / page-passed value) —
 *      never a lying 0-chip off the error body.
 *   2. OK + numeric count ⇒ the badge shows the real number.
 *   3. The request rides the page's useAdminHeaders value (no
 *      empty-string Bearer when logged out is even constructible here,
 *      but the Authorization header must be the token-shaped one).
 *
 * Module mocks follow global-search.test.tsx (the same AdminLayout
 * surface, scoped to the badge endpoints).
 */

import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { AdminLayout } from "@/pages/admin/layout";

// R115 (A9 P2): the pendingTopups badge tests flip the finance scope —
// the auth mock reads from hoisted mutable state (default: every
// scope granted, matching the pre-existing tests).
const { authState } = vi.hoisted(() => ({ authState: { finance: true } }));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    adminToken: "test-admin-token",
    adminLogout: vi.fn(),
    hasAdminPermission: (scope: string) => authState[scope] !== false,
  }),
}));

vi.mock("@/lib/theme", () => ({
  useTheme: () => ({ theme: "dark", toggleTheme: vi.fn() }),
}));

vi.mock("@/hooks/use-toast", () => ({
  toast: vi.fn(),
}));

vi.mock("@/components/admin/copilot/CopilotPanel", () => ({
  CopilotPanel: () => null,
}));

function resLike(over: { ok?: boolean; status?: number; body?: unknown } = {}) {
  const { ok = true, status = 200, body = {} } = over;
  // R115: the layout's stats subscription rides the REAL generated
  // useGetAdminStats hook — i.e. the real customFetch, which parses via
  // .text() + JSON.parse and infers the response type from the
  // content-type header (a bare {ok,status,json()} stub throws "Cannot
  // read properties of undefined (reading 'get')" inside customFetch,
  // and a headerless stub makes customFetch return the RAW STRING —
  // layoutStats.pending_topups would be undefined and the badge never
  // render). The stub therefore carries text() + a faithful
  // application/json content-type, exactly what Express res.json()
  // sends in production (the raw-fetch badge calls only use .json()).
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "content-type" ? "application/json" : null,
    },
  } as unknown as Response;
}

const fetchMock = vi.fn();

function renderLayout() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AdminLayout>
        <div>page-body</div>
      </AdminLayout>
    </QueryClientProvider>,
  );
}

/** The sidebar التنبيهات nav item carrying the unreadAlerts badge chip. */
async function alertBadgeChip(): Promise<string | null> {
  const link = await screen.findByRole("link", { name: /التنبيهات/ });
  return link.textContent ?? null;
}

describe("AdminLayout unread-alerts badge — failures are unknown, never zero (98-F7 R98-06)", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    localStorage.setItem("sn_last_alert_id", "0");
    authState.finance = true;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.removeItem("sn_last_alert_id");
  });

  it("shows the badge count from a healthy response", async () => {
    fetchMock.mockImplementation((input: unknown) => {
      const url = String(input);
      if (url.includes("/api/admin/alerts/unread-count")) {
        return Promise.resolve(resLike({ body: { count: 7 } }));
      }
      if (url.includes("/api/admin/alerts/new")) {
        return Promise.resolve(resLike({ body: { alerts: [] } }));
      }
      return Promise.resolve(resLike({ body: {} }));
    });

    renderLayout();
    await waitFor(async () => {
      expect(await alertBadgeChip()).toContain("7");
    });
  });

  it.each([401, 500, 503])(
    "renders NO badge when the unread-count endpoint answers HTTP %i (error envelope is not a count)",
    async (status) => {
      fetchMock.mockImplementation((input: unknown) => {
        const url = String(input);
        if (url.includes("/api/admin/alerts/unread-count")) {
          // Error envelope — parses as JSON but carries no count. The old
          // code rendered "0" off this exact body.
          return Promise.resolve(resLike({ ok: false, status, body: { error: "x", code: "Y" } }));
        }
        if (url.includes("/api/admin/alerts/new")) {
          return Promise.resolve(resLike({ body: { alerts: [] } }));
        }
        return Promise.resolve(resLike({ body: {} }));
      });

      renderLayout();
      // Wait for the query to settle into its error state (fetch resolves),
      // then assert the chip text has NO digit appended — the old behavior
      // appended "0" to «التنبيهات» via the ?? 0 fallback on the error body.
      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          "/api/admin/alerts/unread-count",
          expect.objectContaining({
            headers: expect.objectContaining({ Authorization: "Bearer test-admin-token" }),
          }),
        );
      });
      await waitFor(async () => {
        const text = await alertBadgeChip();
        expect(text).not.toMatch(/\d/);
      });
    },
  );

  it("sends the useAdminHeaders-shaped Authorization (no empty-string Bearer)", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(resLike({ body: { count: 0 } })));

    renderLayout();
    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) =>
        String(c[0]).includes("/api/admin/alerts/unread-count"),
      );
      expect(call).toBeDefined();
      expect((call![1] as { headers: Record<string, string> }).headers.Authorization).toBe(
        "Bearer test-admin-token",
      );
    });
  });
});

/** The sidebar طلبات الشحن nav item carrying the pendingTopups badge chip. */
async function topupsBadgeChip(): Promise<string | null> {
  const link = await screen.findByRole("link", { name: /طلبات الشحن/ });
  return link.textContent ?? null;
}

describe("AdminLayout pendingTopups badge — stable on EVERY page, server-sourced (R115 A9 P2)", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    localStorage.setItem("sn_last_alert_id", "0");
    authState.finance = true;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.removeItem("sn_last_alert_id");
    authState.finance = true;
  });

  /** Routes fetch: the badge endpoints + the stats endpoint the layout
   *  itself now subscribes to (through the REAL generated client —
   *  customFetch rides the stubbed global fetch). */
  function routeFetch(over: { stats?: () => Response }) {
    return vi.fn((input: unknown) => {
      const url = String(input);
      if (url.includes("/api/admin/stats")) {
        return Promise.resolve(over.stats());
      }
      if (url.includes("/api/admin/alerts/unread-count")) {
        return Promise.resolve(resLike({ body: { count: 0 } }));
      }
      if (url.includes("/api/admin/alerts/new")) {
        return Promise.resolve(resLike({ body: { alerts: [] } }));
      }
      return Promise.resolve(resLike({ body: {} }));
    });
  }

  it("renders the server count with NO page-passed badges (the layout fetches it itself)", async () => {
    fetchMock.mockImplementation(
      routeFetch({
        stats: () =>
          resLike({
            body: {
              total_users: 17,
              total_orders: 5,
              total_revenue: 241.49,
              pending_topups: 4,
              today_orders: 0,
              today_revenue: 0,
              available_stock: 120,
              total_wallet_balance: 826,
            },
          }),
      }),
    );

    // NOTE: no `badges` prop — pre-R115 the chip vanished on every page
    // that didn't pass one (15/19 admin pages).
    renderLayout();

    await waitFor(async () => {
      expect(await topupsBadgeChip()).toContain("4");
    });
  });

  it("a stats failure renders NO topups chip digit (error = unknown, never 0)", async () => {
    fetchMock.mockImplementation(
      routeFetch({
        stats: () => resLike({ ok: false, status: 500, body: { error: "x", code: "Y" } }),
      }),
    );

    renderLayout();
    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => String(c[0]).includes("/api/admin/stats"));
      expect(call).toBeDefined();
    });
    await waitFor(async () => {
      const text = await topupsBadgeChip();
      expect(text).not.toMatch(/\d/);
    });
  });

  it("an admin WITHOUT the finance scope never polls stats (the nav item is finance-scoped)", async () => {
    authState.finance = false;
    fetchMock.mockImplementation(routeFetch({ stats: () => resLike({ body: { pending_topups: 9 } }) }));

    renderLayout();

    // The other badge endpoints fire; stats never does.
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some((c) => String(c[0]).includes("/api/admin/alerts/unread-count")),
      ).toBe(true);
    });
    await waitFor(() => {
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/api/admin/stats"))).toBe(
        false,
      );
    });
  });
});
