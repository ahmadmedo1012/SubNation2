/**
 * R127-L5 (B15-1) — the security page's «إجراءات المسؤولين» tab.
 *
 * The admin audit trail existed only server-side (audit_logs, 6+
 * writers, zero readers) — the operator had NO console view of WHO did
 * WHAT WHEN for money actions (B15-1). This suite pins the tab:
 *
 *   1. RENDER — switching to the tab fetches /api/admin/audit-logs
 *      (the generated useListAdminAuditLogs hook) and renders the
 *      table: actor attribution (@username / نوع #id), the Arabic
 *      action map (actionLabel idiom — «اعتماد شحن رصيد» for
 *      topup.approve) with the raw stable string, target, IP, time.
 *   2. B11-F1 attribution — a telegram-webhook row (actorId null)
 *      names the actor through its metadata line (source=… · actor=…).
 *   3. EMPTY — the Arabic empty state («لا توجد إجراءات مسجّلة»),
 *      never a bare table.
 *   4. ERROR — a failed load renders the honest error card + retry
 *      (NEVER the false empty state); retry recovers.
 *   5. PAGINATION — the finite pager over the frozen ?page=&limit=
 *      contract: «السابقة» disabled at page 1, «التالية» gated on the
 *      server's hasMore, page flip requests page=2 and renders its
 *      rows, and the honest «عرض N من إجمالاً M» counter renders.
 *   6. FILTERS — the action input (300 ms debounce, orders.tsx idiom)
 *      + actor id + date range ride into the query params.
 *
 * Module-boundary mocks + resLike follow security-timeline-honesty
 * .test.tsx (the REAL customFetch parses these stubs — headers +
 * text()).
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

function makeAuditLog(over: Partial<Record<string, unknown>> & { id: number }) {
  return {
    actorId: 3,
    actorType: "admin",
    actorUsername: "ops_manager",
    action: "topup.approve",
    targetType: "topup",
    targetId: 41,
    metadata: JSON.stringify({ admin_note: null, reviewed_by: "ops_manager" }),
    ip: "41.208.0.1",
    createdAt: "2026-10-02T10:00:00.000Z",
    ...over,
  };
}

/** Minimal Response-like object — the REAL customFetch parses these
 * stubs (headers + text()). */
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
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Router>
        <AdminSecurityDashboard />
      </Router>
    </QueryClientProvider>,
  );
}

/** Switch to the audit tab (the default pane is the auth timeline —
 * pinned by security-timeline-honesty.test.tsx). */
async function openAuditTab() {
  fireEvent.click(screen.getByRole("tab", { name: /إجراءات المسؤولين/ }));
  await screen.findByRole("tabpanel");
}

function auditBody(logs: unknown[], total: number, hasMore: boolean) {
  return { logs, total, page: 1, limit: 50, hasMore };
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
      return Promise.resolve(resLike({ body: { activities: [] } }));
    }
    if (url.startsWith("/api/admin/audit-logs")) {
      return Promise.resolve(resLike({ body: auditBody([makeAuditLog({ id: 1 })], 1, false) }));
    }
    return Promise.resolve(resLike());
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AdminSecurityDashboard — «إجراءات المسؤولين» tab (B15-1)", () => {
  it("renders the audit table: actor, Arabic action + raw string, target, IP, time", async () => {
    renderPage();
    await openAuditTab();

    // Row content: attribution + the actionLabel-style Arabic map.
    await screen.findByText("@ops_manager");
    expect(screen.getByText("اعتماد شحن رصيد")).toBeInTheDocument();
    expect(screen.getByText("topup.approve")).toBeInTheDocument();
    expect(screen.getByText("topup #41")).toBeInTheDocument();
    expect(screen.getByText("41.208.0.1")).toBeInTheDocument();

    // Column headers.
    for (const header of ["المسؤول", "الإجراء", "الهدف", "IP", "الوقت"]) {
      expect(screen.getByRole("columnheader", { name: header })).toBeInTheDocument();
    }
  });

  it("a telegram-webhook row (actorId null) names the actor via the metadata line (B11-F1)", async () => {
    fetchMock.mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.startsWith("/api/admin/audit-logs")) {
        return Promise.resolve(
          resLike({
            body: auditBody(
              [
                makeAuditLog({
                  id: 9,
                  actorId: null,
                  actorUsername: null,
                  action: "topup.reject",
                  targetId: 42,
                  metadata: JSON.stringify({
                    source: "telegram_webhook",
                    actor: "tg:222222",
                    from_id: 222222,
                  }),
                }),
              ],
              1,
              false,
            ),
          }),
        );
      }
      return Promise.resolve(resLike({ body: STATS }));
    });

    renderPage();
    await openAuditTab();

    await screen.findByText("topup.reject");
    // The no-username actor arm renders the actor-type label, and the
    // metadata line carries the B11-F1 attribution.
    expect(screen.getByText("مسؤول")).toBeInTheDocument();
    expect(screen.getByText(/source=telegram_webhook/)).toBeInTheDocument();
    expect(screen.getByText(/actor=tg:222222/)).toBeInTheDocument();
  });

  it("empty window renders the Arabic empty state, not a bare table", async () => {
    fetchMock.mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.startsWith("/api/admin/audit-logs")) {
        return Promise.resolve(resLike({ body: auditBody([], 0, false) }));
      }
      return Promise.resolve(resLike({ body: STATS }));
    });

    renderPage();
    await openAuditTab();

    expect(await screen.findByText("لا توجد إجراءات مسجّلة")).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "الإجراء" })).not.toBeInTheDocument();
  });

  it("a failed load renders the error card + retry — NEVER the false empty state", async () => {
    fetchMock.mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.startsWith("/api/admin/audit-logs")) {
        return Promise.resolve(
          resLike({ ok: false, status: 500, body: { error: "خطأ في الخادم" } }),
        );
      }
      return Promise.resolve(resLike({ body: STATS }));
    });

    renderPage();
    await openAuditTab();

    expect(await screen.findByText("تعذّر تحميل سجل الإجراءات")).toBeInTheDocument();
    expect(screen.queryByText("لا توجد إجراءات مسجّلة")).not.toBeInTheDocument();

    // Retry recovers once the endpoint answers.
    fetchMock.mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.startsWith("/api/admin/audit-logs")) {
        return Promise.resolve(resLike({ body: auditBody([makeAuditLog({ id: 5 })], 1, false) }));
      }
      return Promise.resolve(resLike({ body: STATS }));
    });
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: /إعادة المحاولة/ })[0]);
    });
    await waitFor(() => expect(screen.getByText("@ops_manager")).toBeInTheDocument());
  });
});

describe("AdminSecurityDashboard — audit tab pagination (finite pager)", () => {
  it("page 1: «السابقة» disabled, «التالية» gated on hasMore; a flip requests page=2 and renders its rows", async () => {
    const requests: string[] = [];
    fetchMock.mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.startsWith("/api/admin/audit-logs")) {
        requests.push(url);
        const pageTwo = url.includes("page=2");
        return Promise.resolve(
          resLike({
            body: {
              logs: [makeAuditLog({ id: pageTwo ? 200 : 100, targetId: pageTwo ? 77 : 41 })],
              total: 2,
              page: pageTwo ? 2 : 1,
              limit: 50,
              hasMore: !pageTwo,
            },
          }),
        );
      }
      return Promise.resolve(resLike({ body: STATS }));
    });

    renderPage();
    await openAuditTab();

    await screen.findByText("topup #41");
    // Honest counter: عرض 1 من إجمالاً 2 (formatCount Arabic plurals).
    expect(screen.getByText(/عرض 1 إجراء من إجمالاً 2 إجراءان/)).toBeInTheDocument();

    const prev = screen.getByRole("button", { name: /السابقة/ });
    const next = screen.getByRole("button", { name: /التالية/ });
    expect(prev).toBeDisabled();
    expect(next).toBeEnabled();

    await act(async () => {
      fireEvent.click(next);
    });
    await screen.findByText("topup #77");
    expect(requests.some((r) => r.includes("page=2"))).toBe(true);

    // Page 2 is the last page (hasMore=false) — «التالية» disabled,
    // «السابقة» enabled.
    expect(screen.getByRole("button", { name: /التالية/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /السابقة/ })).toBeEnabled();
  });
});

describe("AdminSecurityDashboard — audit tab filters", () => {
  it("action (debounced) + actor id + date range ride into the query params", async () => {
    const requests: string[] = [];
    fetchMock.mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.startsWith("/api/admin/audit-logs")) {
        requests.push(url);
        return Promise.resolve(resLike({ body: auditBody([], 0, false) }));
      }
      return Promise.resolve(resLike({ body: STATS }));
    });

    renderPage();
    await openAuditTab();
    await screen.findByText("لا توجد إجراءات مسجّلة");

    // Action text — the 300 ms debounce (orders.tsx idiom).
    await act(async () => {
      fireEvent.change(screen.getByLabelText("الإجراء:"), {
        target: { value: "topup.approve" },
      });
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 350));
    });
    await waitFor(() =>
      expect(requests.some((r) => r.includes("action=topup.approve"))).toBe(true),
    );

    // Actor id.
    await act(async () => {
      fireEvent.change(screen.getByLabelText("معرّف المسؤول:"), { target: { value: "3" } });
    });
    await waitFor(() => expect(requests.some((r) => r.includes("actor=3"))).toBe(true));

    // Date range (type=date fires change with YYYY-MM-DD values).
    await act(async () => {
      fireEvent.change(screen.getByLabelText("من تاريخ:"), {
        target: { value: "2026-10-01" },
      });
    });
    await act(async () => {
      fireEvent.change(screen.getByLabelText("إلى تاريخ:"), {
        target: { value: "2026-10-31" },
      });
    });
    await waitFor(() =>
      expect(
        requests.some(
          (r) => r.includes("startDate=2026-10-01") && r.includes("endDate=2026-10-31"),
        ),
      ).toBe(true),
    );
  });
});
