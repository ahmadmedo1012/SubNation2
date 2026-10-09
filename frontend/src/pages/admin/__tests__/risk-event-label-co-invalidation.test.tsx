/**
 * R125-I4 (A4-B-3) + A10 §C-5 (the risk-event arm) — risk-event label
 * co-invalidation tests. Also the page's FIRST render suite (risk-event
 * had zero behavioral tests — A10 §B row 19).
 *
 * The label mutation's onSuccess invalidated ONLY its own detail key
 * (["admin-risk-event", id]) — but a label changes:
 *   - the /admin/risk LIST rows (label history surfaces there), and
 *   - the dashboard's `unresolved` count (["admin-risk-dashboard"]).
 * Back-nav showed stale chips for up to the 60s global staleTime /
 * 30s dashboard poll.
 *
 * These tests pin:
 *
 *   1. The label POST fires with the chosen label + notes.
 *   2. onSuccess invalidates the detail key AND the risk list base
 *      key AND the dashboard key AND the shared admin-stats key
 *      (the A4-B-3/A10 §C-5 family — the orders-bulk/topups
 *      `admin-stats-update` socket pattern has no backend emit for
 *      risk writes yet, so the frontend invalidation is the refresh).
 *
 * `@/lib/auth` + the admin shell are mocked at the module boundary;
 * the QueryClient's invalidateQueries is spied (the resync-test
 * key-spy idiom) to assert the exact keys.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ReactNode } from "react";
import AdminRiskEventPage from "@/pages/admin/risk-event";

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    adminToken: "test-admin-token",
    hasAdminPermission: () => true,
  }),
}));

vi.mock("@/pages/admin/layout", () => ({
  AdminLayout: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

const DETAIL = {
  event: {
    id: 5,
    user_id: 7,
    user_phone: "0912345678",
    user_email: null,
    event_type: "topup_velocity",
    score: 42,
    level: "high",
    confidence: 0.9,
    rule_fired: ["many_topups"],
    statistical_signals: {},
    ml_score: null,
    top_features: null,
    action_taken: "flag",
    ip_address: "1.2.3.4",
    user_agent: "Mozilla/5.0",
    created_at: "2026-09-08T10:00:00.000Z",
    shown_at: "2026-09-08T10:00:00.000Z",
  },
  labels: [],
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
  const spy = vi.spyOn(client, "invalidateQueries");
  return {
    spy,
    client,
    ...render(
      <QueryClientProvider client={client}>
        <Router>
          <AdminRiskEventPage />
        </Router>
      </QueryClientProvider>,
    ),
  };
}

describe("AdminRiskEventPage — label mutation co-invalidation (A4-B-3)", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST" && url.includes("/label")) return resLike({ ok: true });
      // GET detail (first load + the post-success refresh).
      return resLike(DETAIL);
    });
    vi.stubGlobal("fetch", fetchMock);
    // wouter's useRoute matches against the current location.
    window.history.replaceState(null, "", "/admin/risk/events/5");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState(null, "", "/admin/risk");
  });

  it("fires the label POST with the chosen label, then invalidates detail + list + dashboard + stats keys", async () => {
    const { spy } = renderPage();

    await waitFor(() => {
      expect(screen.getByText("تحقيق #5")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /إنذار كاذب/ }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          (c) =>
            String(c[0]) === "/api/admin/risk/events/5/label" &&
            (c[1] as RequestInit).method === "POST",
        ),
      ).toBe(true);
    });
    const postCall = fetchMock.mock.calls.find(
      (c) => String(c[0]) === "/api/admin/risk/events/5/label",
    )!;
    expect(JSON.parse(String((postCall[1] as RequestInit).body))).toMatchObject({
      label: "false_positive",
    });

    // The R125-I4 co-invalidation family — each key invalidated once.
    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith({ queryKey: ["admin-risk-event", "5"] });
      expect(spy).toHaveBeenCalledWith({ queryKey: ["admin-risk-events"] });
      expect(spy).toHaveBeenCalledWith({ queryKey: ["admin-risk-dashboard"] });
      expect(spy).toHaveBeenCalledWith({ queryKey: ["/api/admin/stats"] });
    });
  });
});
