/**
 * R133 (A3-F5) — risk-event detail: the users-scope gate + the
 * 404-vs-outage fork.
 *
 * The detail page used to: (a) mount + fire its query for ANY
 * authenticated admin (the backend risk family is users-scoped — the
 * list page already gated on it), (b) render a bare-text loader, and
 * (c) answer every failure with a dead-end «فشل تحميل الحدث» banner —
 * a missing event and an outage got the same message with no retry.
 *
 * Pins:
 *   1. A users-scope-less admin sees the honest-reason banner and the
 *      detail query never fires.
 *   2. A 404 renders «الحدث غير موجود» + the back link — and NO retry
 *      (retrying a dead id can never work; that button would lie).
 *   3. A 5xx renders the FetchErrorCard WITH retry, and the retry
 *      recovers the investigation view.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ReactNode } from "react";
import AdminRiskEventPage from "@/pages/admin/risk-event";

const authState: Record<string, boolean> = {};
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    adminToken: "test-admin-token",
    hasAdminPermission: (scope: string) => authState[scope] !== false,
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
        <AdminRiskEventPage />
      </Router>
    </QueryClientProvider>,
  );
}

describe("AdminRiskEventPage — users-scope gate (A3-F5, R133)", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(null, "", "/admin/risk/events/5");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState(null, "", "/admin/risk");
    for (const k of Object.keys(authState)) delete authState[k];
  });

  it("a users-scope-less admin sees the honest-reason banner and fires NOTHING", async () => {
    authState.users = false;

    renderPage();

    expect(
      await screen.findByText("تحقيقات المخاطر تتطلب صلاحية المستخدمين — تواصل مع مسؤول النظام"),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a 404 renders «الحدث غير موجود» + the back link — NO retry (a dead id cannot be retried)", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(resLike({ ok: false, status: 404, body: { error: "الحدث غير موجود" } })),
    );

    renderPage();

    expect(await screen.findByText("الحدث غير موجود")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "رجوع لقائمة الأحداث" })).toBeInTheDocument();
    // The outage card must NOT render for a 404…
    expect(screen.queryByText("تعذّر تحميل الحدث")).not.toBeInTheDocument();
    // …and no retry button anywhere (retrying a dead id lies).
    expect(screen.queryByRole("button", { name: "إعادة المحاولة" })).not.toBeInTheDocument();
  });

  it("a 5xx renders the FetchErrorCard WITH retry, and the retry recovers the investigation view", async () => {
    let calls = 0;
    fetchMock.mockImplementation(() => {
      calls += 1;
      if (calls === 1) {
        return Promise.resolve(resLike({ ok: false, status: 500, body: { error: "boom" } }));
      }
      return Promise.resolve(resLike({ body: DETAIL }));
    });

    renderPage();

    const retry = await screen.findByRole("button", { name: "إعادة المحاولة" });
    expect(screen.getByText("تعذّر تحميل الحدث")).toBeInTheDocument();
    // The 404 branch must NOT render for an outage.
    expect(screen.queryByText("الحدث غير موجود")).not.toBeInTheDocument();

    fireEvent.click(retry);

    // Recovered: the investigation header renders (the page's own
    // «تحقيق #5» h1).
    await waitFor(() => {
      expect(screen.getByText("تحقيق #5")).toBeInTheDocument();
    });
    expect(screen.queryByText("تعذّر تحميل الحدث")).not.toBeInTheDocument();
  });
});
