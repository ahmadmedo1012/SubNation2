/**
 * R125-I4 (A3-11) + A10 §C-44 (the risk half) — risk deep-link RBAC
 * honest-reason tests.
 *
 * /admin/risk gates via the NAV only (layout.tsx scopes the item to
 * "users"): an admin without the users scope who deep-links (or
 * follows a shared URL) mounted the page, fired the queries, and
 * landed on generic failure banners. The settings.tsx tabAllowed
 * idiom now renders the honest reason up front — and fires NOTHING.
 *
 *   1. A scope-less admin sees the honest-reason card and NO query
 *      fires.
 *   2. A users-scoped admin gets the real page (the gate must not
 *      over-block the legitimate operator).
 *
 * (A10 §C-44 names the file `risk-system-rbac-gate.test.tsx`; the
 * system.tsx half belongs to another lane — this file covers the risk
 * half only.)
 *
 * `@/lib/auth` + the admin shell are mocked at the module boundary
 * (referrals-finance-gate mock pattern — a mutable authState lets each
 * case grant/deny exactly the scopes it needs).
 */

import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ReactNode } from "react";
import AdminRiskPage from "@/pages/admin/risk";

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
        <AdminRiskPage />
      </Router>
    </QueryClientProvider>,
  );
}

describe("AdminRiskPage — deep-link RBAC honest-reason gate (A3-11)", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () =>
      resLike({
        window_hours: 24,
        total: 0,
        by_level: { low: 0, medium: 0, high: 0, critical: 0 },
        unresolved: 0,
        top_rules: [],
        pipeline: { enabled: true },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    for (const k of Object.keys(authState)) delete authState[k];
  });

  it("a users-scope-less admin sees the honest reason and fires NO query", async () => {
    authState["users"] = false;

    renderPage();

    expect(
      await screen.findByText("مراقبة المخاطر تتطلب صلاحية المستخدمين — تواصل مع مسؤول النظام"),
    ).toBeInTheDocument();
    // No queries fired — the 403-wall / generic-banner path is dead.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a users-scoped admin gets the real page", async () => {
    authState["users"] = true;

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("مراقبة المخاطر")).toBeInTheDocument();
    });
    expect(screen.queryByText("مراقبة المخاطر تتطلب صلاحية المستخدمين")).not.toBeInTheDocument();
    // The page mounted and its queries fired (dashboard + events).
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
