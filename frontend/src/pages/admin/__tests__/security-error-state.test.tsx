/**
 * 94-C2 (A2 P2-1 + P3-18) — security dashboard error-surface tests.
 *
 * The page is the oldest admin screen and had NO error handling at
 * all: both fetches swallowed failures with `console.error` — `stats`
 * stayed null (the cards silently vanished) and `activities` stayed
 * `[]` ⇒ the "لا توجد أنشطة" empty state during an outage or an
 * expired session. These tests pin:
 *
 *   1. A failed stats load surfaces an inline error banner (role=alert
 *      + retry), not silently-missing cards.
 *   2. A failed activities load renders the error card — NEVER the
 *      "لا توجد أنشطة" false-empty state.
 *   3. Retry recovers both panels once the API responds.
 *   4. (P3-18) The timeline translates the backend `action` enum to
 *      Arabic ("login" → «تسجيل دخول») in lockstep with the filters.
 *
 * `@/lib/auth` and the admin shell are mocked at the module boundary
 * (vitest-config pattern); the page uses plain fetch + state.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Router } from "wouter";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { type ReactNode } from "react";
import AdminSecurityDashboard from "@/pages/admin/security";

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ adminToken: "test-admin-token" }),
}));

vi.mock("@/pages/admin/layout", () => ({
  AdminLayout: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

const STATS = { total: 120, success: 100, failure: 20, last24h: 12 };

const ACTIVITY = {
  id: 1,
  userId: 16,
  identifier: "0913456789",
  action: "login",
  success: true,
  provider: null,
  failureReason: null,
  ipAddress: "1.2.3.4",
  userAgent: null,
  createdAt: "2026-09-08T10:00:00.000Z",
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

function renderPage() {
  return render(
    <Router>
      <AdminSecurityDashboard />
    </Router>,
  );
}

/** Routes the fetch mock: summary + activity endpoints. */
function routeFetch(
  summary: () => Promise<Response>,
  activities: () => Promise<Response> = () =>
    Promise.resolve(resLike({ body: { activities: [ACTIVITY] } })),
) {
  fetchMock.mockImplementation(async (input: unknown) => {
    const url = String(input);
    if (url.startsWith("/api/admin/auth-stats/summary")) return summary();
    if (url.startsWith("/api/admin/auth-activity")) return activities();
    return Promise.resolve(resLike());
  });
}

describe("AdminSecurityDashboard — failures surface, never console.error (A2 P2-1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("a failed stats load shows the inline error banner with retry (cards don't just vanish)", async () => {
    routeFetch(() =>
      Promise.resolve(resLike({ ok: false, status: 500, body: { error: "خطأ في الخادم" } })),
    );

    renderPage();

    const banner = await screen.findByRole("alert");
    expect(banner.textContent).toContain("خطأ في الخادم");
    expect(screen.getByRole("button", { name: "إعادة المحاولة" })).toBeInTheDocument();
  });

  it("a failed activities load renders the error card, NEVER the 'لا توجد أنشطة' empty state", async () => {
    routeFetch(
      () => Promise.resolve(resLike({ body: STATS })),
      () =>
        Promise.resolve(
          resLike({ ok: false, status: 500, body: { error: "خطأ في الخادم" } }),
        ),
    );

    renderPage();

    expect(await screen.findByText("تعذّر تحميل سجل النشاط")).toBeInTheDocument();
    expect(screen.queryByText("لا توجد أنشطة")).not.toBeInTheDocument();
    // The stats panel still rendered — one failing fetch doesn't take
    // the other down.
    expect(screen.getByText("120")).toBeInTheDocument();
  });

  it("retry re-fetches and recovers the timeline once the API responds", async () => {
    let activitiesFail = true;
    routeFetch(
      () => Promise.resolve(resLike({ body: STATS })),
      () =>
        activitiesFail
          ? Promise.resolve(
              resLike({ ok: false, status: 503, body: { error: "تعذّر الاتصال" } }),
            )
          : Promise.resolve(resLike({ body: { activities: [ACTIVITY] } })),
    );

    renderPage();

    const retry = await screen.findByRole("button", { name: "إعادة المحاولة" });
    activitiesFail = false;
    fireEvent.click(retry);

    // The timeline recovered — the Arabic action label renders.
    await waitFor(() => expect(screen.getByText("تسجيل دخول")).toBeInTheDocument());
    expect(screen.queryByText("تعذّر تحميل سجل النشاط")).not.toBeInTheDocument();
  });

  it("the timeline translates the backend action enum to Arabic (A2 P3-18)", async () => {
    routeFetch(() => Promise.resolve(resLike({ body: STATS })));

    renderPage();

    await waitFor(() => expect(screen.getByText("0913456789")).toBeInTheDocument());
    // Raw "login" is never shown — the shared ACTION_LABELS map keeps
    // the timeline in lockstep with the Arabic filter options. The
    // label appears at least twice: once as a <select> option and once
    // as the timeline row's translated action.
    expect(screen.queryByText(/^login$/)).not.toBeInTheDocument();
    expect(screen.getAllByText("تسجيل دخول").length).toBeGreaterThanOrEqual(2);
  });
});
