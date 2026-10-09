/**
 * R125-I4 (A3-2 — P2) + A10 §C-24 — risk page error/empty gate tests.
 *
 * risk.tsx used to render the load-failure banner AND the «لا توجد
 * أحداث في النطاق المحدد» EmptyState together: on a failed load
 * `events` is `[]` and `isLoading` is false, so the empty branch fired
 * right below the banner — an operator skimming past it read "no fraud
 * events" during an outage (the B5-04 class every other admin list
 * page killed; risk.tsx was first-audited in R125-A3 and never brought
 * into the contract).
 *
 * These tests pin the fix AND serve as the page's first render suite
 * (risk had ZERO behavioral tests before this round — A10 §B):
 *
 *   1. A failed load renders the error card (with retry) and NEVER
 *      the EmptyState.
 *   2. Retry re-fetches and recovers the queue.
 *   3. A successful load with zero events still renders the TRUE
 *      empty state (the gate must not over-block).
 *   4. A failed refresh of an already-rendered list keeps the stale
 *      rows + surfaces an inline banner with its own retry.
 *
 * `@/lib/auth`, the admin shell are mocked at the module boundary
 * (vitest-config pattern); adminFetchJson rides the stubbed global
 * fetch (the tickets-error-state harness).
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

const DASHBOARD = {
  window_hours: 24,
  total: 1,
  by_level: { low: 0, medium: 1, high: 0, critical: 0 },
  unresolved: 0,
  top_rules: [],
  pipeline: { enabled: true },
};

const EVENT = (id: number) => ({
  id,
  user_id: 7,
  user_phone: "0912345678",
  user_email: null,
  event_type: "topup_velocity",
  score: 42,
  level: "medium",
  confidence: 0.87,
  rule_fired: ["many_topups"],
  action_taken: "flag",
  ip_address: null,
  created_at: "2026-09-08T10:00:00.000Z",
  shown_at: null,
});

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

function renderPage() {
  // The page rides useInfiniteQuery — a fresh client per render
  // (retry: false) per the page-test convention.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Router>
        <AdminRiskPage />
      </Router>
    </QueryClientProvider>,
  );
}

describe("AdminRiskPage — an error is an error, never a false empty queue (A3-2)", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    for (const k of Object.keys(authState)) delete authState[k];
  });

  it("a failed load renders the error card with a retry — NEVER the EmptyState", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("تعذّر تحميل الأحداث")).toBeInTheDocument();
    });
    // Crucially NOT "no fraud events" — an outage is not an empty risk queue.
    expect(screen.queryByText("لا توجد أحداث في النطاق المحدد")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "إعادة المحاولة" })).toBeInTheDocument();
  });

  it("retry re-fetches and recovers the events once the API responds", async () => {
    fetchMock.mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/risk/dashboard")) return resLike({ body: DASHBOARD });
      // First events fetch fails; the retry succeeds.
      if (fetchMock.mock.calls.filter((c) => String(c[0]).includes("/risk/events")).length <= 1) {
        throw new Error("network down");
      }
      return resLike({ body: { events: [EVENT(1)], next_cursor: null } });
    });

    renderPage();

    const retry = await screen.findByRole("button", { name: "إعادة المحاولة" });
    fireEvent.click(retry);

    expect(await screen.findByRole("link", { name: "فتح تحقيق الحدث رقم 1" })).toBeInTheDocument();
    expect(screen.queryByText("تعذّر تحميل الأحداث")).not.toBeInTheDocument();
  });

  it("still renders the true empty state when the load succeeds with zero events", async () => {
    fetchMock.mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/risk/dashboard")) return resLike({ body: DASHBOARD });
      return resLike({ body: { events: [], next_cursor: null } });
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("لا توجد أحداث في النطاق المحدد")).toBeInTheDocument();
    });
    expect(screen.queryByText("تعذّر تحميل الأحداث")).not.toBeInTheDocument();
  });

  it("a failed refresh of rendered rows keeps the rows + an inline banner with retry", async () => {
    let eventsCalls = 0;
    fetchMock.mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/risk/dashboard")) return resLike({ body: DASHBOARD });
      eventsCalls += 1;
      if (eventsCalls === 1) {
        return resLike({ body: { events: [EVENT(1), EVENT(2)], next_cursor: null } });
      }
      throw new Error("network down");
    });

    renderPage();

    // First load lands — the drill-in links exist (one per row).
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "فتح تحقيق الحدث رقم 1" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "تحديث" }));

    // The refresh fails: rows stay visible + the stale banner appears.
    await waitFor(() => {
      expect(screen.getByText("تعذّر تحديث الأحداث")).toBeInTheDocument();
    });
    expect(screen.getByRole("link", { name: "فتح تحقيق الحدث رقم 1" })).toBeInTheDocument();
    // And the banner's own retry (A3-2: the old banner had no action).
    expect(screen.getAllByRole("button", { name: "إعادة المحاولة" }).length).toBeGreaterThan(0);
  });
});
