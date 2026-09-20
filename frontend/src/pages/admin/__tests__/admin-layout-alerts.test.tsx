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

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    adminToken: "test-admin-token",
    adminLogout: vi.fn(),
    hasAdminPermission: () => true,
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
  return { ok, status, json: () => Promise.resolve(body) } as unknown as Response;
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
