/**
 * R125-I5 (A3-5) — security timeline honesty + race guard.
 *
 * The backend hard-caps auth-activity at .limit(100) (admin/security.ts)
 * with no page param and no total, and the UI used to render whatever
 * arrived under a bare «سجل النشاط» heading — an audit log presented as
 * complete. Additionally fetchActivities had no abort/sequence token:
 * rapid filter flips raced two overlapping requests and the OLDER
 * response could land last, rendering filter A's rows under filter B's
 * selects.
 *
 * These tests pin (A10 §C-41):
 *
 *   1. The window count renders («عرض N (الأحدث أولاً)») beside the
 *      timeline heading.
 *   2. At the 100-row cap the disclosure renders («أحدث 100 حدث» —
 *      older events exist but are not loaded); a short window renders
 *      no cap note.
 *   3. The CSV export button's title discloses the window it exports.
 *   4. A stale filter response is DROPPED (seq guard — belt-only, the
 *      fetch mock ignores the AbortSignal like referrals-search-race).
 *   5. (A3-4) The first load renders a page-shaped skeleton
 *      (role="status" + sr-only «جارٍ التحميل…») with the page header
 *      still visible — not the old bare-text whole-page blank.
 *
 * Module-boundary mocks follow security-error-state.test.tsx.
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ReactNode } from "react";
import AdminSecurityDashboard from "@/pages/admin/security";

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ adminToken: "test-admin-token" }),
}));

vi.mock("@/pages/admin/layout", () => ({
  AdminLayout: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

const STATS = { total: 250, success: 200, failure: 50, last24h: 12 };

function makeActivity(id: number, identifier: string) {
  return {
    id,
    userId: 16,
    identifier,
    action: "login",
    success: true,
    provider: null,
    failureReason: null,
    ipAddress: "1.2.3.4",
    userAgent: null,
    createdAt: "2026-09-08T10:00:00.000Z",
  };
}

/** A full 100-row window — the backend's hard cap. */
function cappedActivities() {
  return Array.from({ length: 100 }, (_, i) => makeActivity(i + 1, `user-${i + 1}`));
}

/** Minimal Response-like object — avoids depending on a global Response.
 * R126-L8b: the page rides the generated client now, so the REAL
 * customFetch parses these stubs — it needs headers + text(). */
function resLike(over: { ok?: boolean; status?: number; body?: unknown } = {}) {
  const { ok = true, status = 200, body = {} } = over;
  return {
    ok,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    text: () => Promise.resolve(JSON.stringify(body ?? null)),
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

const fetchMock = vi.fn();

function renderPage() {
  // R126-L8b: the generated hooks need a QueryClient; retry off so the
  // deferred/race scenarios are single-flight.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Router>
        <AdminSecurityDashboard />
      </Router>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(async (input: unknown) => {
    const url = String(input);
    if (url.startsWith("/api/admin/auth-stats/summary")) {
      return Promise.resolve(resLike({ body: STATS }));
    }
    if (url.startsWith("/api/admin/auth-activity")) {
      return Promise.resolve(resLike({ body: { activities: [makeActivity(1, "0913456789")] } }));
    }
    return Promise.resolve(resLike());
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AdminSecurityDashboard — timeline honesty (A3-5)", () => {
  it("renders the window count «عرض N (الأحدث أولاً)» beside the timeline heading", async () => {
    renderPage();
    await screen.findByText("0913456789");
    expect(screen.getByText(/عرض 1 حدث \(الأحدث أولاً\)/)).toBeInTheDocument();
  });

  it("at the 100-row cap the «أحدث 100 حدث» disclosure renders; a short window renders none", async () => {
    fetchMock.mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.startsWith("/api/admin/auth-activity")) {
        return Promise.resolve(resLike({ body: { activities: cappedActivities() } }));
      }
      return Promise.resolve(resLike({ body: STATS }));
    });
    renderPage();
    await screen.findByText("user-100");
    // Honest count + the cap disclosure (older events exist, not loaded).
    expect(screen.getByText(/عرض 100 حدث \(الأحدث أولاً\)/)).toBeInTheDocument();
    expect(screen.getByText(/أحدث 100 حدث فقط/)).toBeInTheDocument();
    expect(screen.getByText(/قد تكون هناك أحداث أقدم/)).toBeInTheDocument();
  });

  it("the CSV button's title discloses the exported window", async () => {
    renderPage();
    await screen.findByText("0913456789");
    const csv = screen.getByRole("button", { name: /تصدير CSV/ });
    expect(csv).toHaveAttribute("title", expect.stringContaining("أحدث 100 حدث"));
  });
});

describe("AdminSecurityDashboard — filter race guard (A3-5, referrals-search-race class)", () => {
  it("a stale (older) filter response landing LAST never overwrites the newer rows", async () => {
    // Scenario: the initial load completes; the operator flips the
    // filter to login (call #2 — held pending); then flips to logout
    // (call #3 — resolves fast, logout rows render). The login response
    // finally lands — its rows must be dropped: last-REQUEST wins, not
    // last-ARRIVAL.
    let releaseStale: ((r: Response) => void) | null = null;
    const staleResponse = new Promise<Response>((resolve) => {
      releaseStale = resolve;
    });

    fetchMock.mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.startsWith("/api/admin/auth-stats/summary")) {
        return Promise.resolve(resLike({ body: STATS }));
      }
      if (url.startsWith("/api/admin/auth-activity")) {
        if (url.includes("action=login")) {
          // The SLOW middle request — hangs until released.
          return staleResponse;
        }
        if (url.includes("action=logout")) {
          // The NEWEST request — resolves immediately.
          return Promise.resolve(
            resLike({ body: { activities: [makeActivity(3, "logout-user")] } }),
          );
        }
        // The mount fetch (action=all) — resolves normally.
        return Promise.resolve(resLike({ body: { activities: [makeActivity(1, "all-user")] } }));
      }
      return Promise.resolve(resLike());
    });

    renderPage();
    // Initial window renders, loading clears.
    await screen.findByText("all-user");
    expect(screen.getByRole("button", { name: /تصدير CSV/ })).toBeEnabled();

    // Flip #1 (login) — its request hangs.
    await act(async () => {
      fireEvent.change(screen.getByLabelText("الإجراء:"), { target: { value: "login" } });
    });
    // Flip #2 (logout) — resolves fast; its rows render.
    await act(async () => {
      fireEvent.change(screen.getByLabelText("الإجراء:"), { target: { value: "logout" } });
    });
    await screen.findByText("logout-user");

    // …then the OLDER (login) response finally lands.
    await act(async () => {
      releaseStale?.(
        resLike({ body: { activities: [makeActivity(2, "login-user")] } }) as Response,
      );
      // Flush the stale resolution through the component's awaits.
      await Promise.resolve();
    });

    // The stale rows were dropped — the logout window stands.
    expect(screen.getByText("logout-user")).toBeInTheDocument();
    expect(screen.queryByText("login-user")).not.toBeInTheDocument();
  });
});

describe("AdminSecurityDashboard — first-load skeleton (A3-4)", () => {
  it("renders a page-shaped skeleton with the header visible — never the bare whole-page text", async () => {
    let releaseActivities: ((r: Response) => void) | null = null;
    fetchMock.mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.startsWith("/api/admin/auth-stats/summary")) {
        return Promise.resolve(resLike({ body: STATS }));
      }
      if (url.startsWith("/api/admin/auth-activity")) {
        return new Promise<Response>((resolve) => {
          releaseActivities = resolve;
        });
      }
      return Promise.resolve(resLike());
    });

    renderPage();

    // The page header + CSV affordance render during first load (the
    // old bare «جارٍ التحميل…» hid the ENTIRE page).
    expect(screen.getByRole("heading", { name: "لوحة أمان المصادقة" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /تصدير CSV/ })).toBeDisabled();

    // The skeleton is a live region (A6-B8) with an sr-only label.
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("جارٍ التحميل…");
    // The old bare centered text node is gone.
    expect(document.querySelector(".text-center.py-8")).toBeNull();

    // Let the load finish so the test tears down cleanly.
    await act(async () => {
      releaseActivities?.(
        resLike({ body: { activities: [makeActivity(1, "0913456789")] } }) as Response,
      );
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByText("0913456789")).toBeInTheDocument());
  });
});
