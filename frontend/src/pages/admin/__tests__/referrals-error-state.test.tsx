/**
 * B5-03 (round-92 audit) — referrals load-failure tests.
 *
 * `fetchData` had a bare `catch {}` and no `res.ok` check: a failed
 * /api/admin/referrals load rendered the misleading "لا توجد إحالات"
 * empty state plus "—"-valued stat cards with zero error signal — an
 * admin could not distinguish "no referrals" from "API down". These
 * tests pin the contract:
 *
 *   1. Network failure ⇒ distinct error card with a retry button
 *      (same idiom as the storefront pages — loyalty.tsx/orders.tsx),
 *      NEVER the empty state, and no "—" stat cards.
 *   2. Non-OK HTTP (5xx envelope) ⇒ same error card.
 *   3. Retry re-fetches and recovers when the API comes back.
 *   4. A successful load with zero referrals still renders the true
 *      empty state (the error branch must not swallow it).
 *
 * `@/lib/auth`, the admin shell and the toast hook are mocked at the
 * module boundary (vitest-config pattern).
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Router } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ReactNode } from "react";
import AdminReferralsPage from "@/pages/admin/referrals";

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ adminToken: "test-admin-token" }),
}));

vi.mock("@/pages/admin/layout", () => ({
  AdminLayout: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock, dismiss: vi.fn() }),
}));

const referralPayload = {
  stats: { total: 2, credited: 1, pending: 1, total_points: 50 },
  top_referrers: [{ id: 7, phone: "0911111111", credited_count: 1, total_count: 2 }],
  list: [
    {
      id: 101,
      status: "pending",
      created_at: "2026-09-01T10:00:00.000Z",
      credited_at: null,
      referrer_phone: "0911111111",
      referrer_id: 7,
      referee_phone: "0922222222",
      points_earned: 0,
    },
    {
      id: 102,
      status: "credited",
      created_at: "2026-09-02T10:00:00.000Z",
      credited_at: "2026-09-03T10:00:00.000Z",
      referrer_phone: "0933333333",
      referrer_id: 8,
      referee_phone: "0944444444",
      points_earned: 50,
    },
  ],
};

const emptyPayload = {
  stats: { total: 0, credited: 0, pending: 0, total_points: 0 },
  top_referrers: [],
  list: [],
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
      <AdminReferralsPage />
    </Router>,
  );
}

describe("AdminReferralsPage — a failed load is an error, not a false empty state (B5-03)", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the error card with a retry action when the network fails", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("تعذّر تحميل الإحالات")).toBeInTheDocument();
    });
    // Crucially NOT the "no referrals" empty state…
    expect(screen.queryByText("لا توجد إحالات")).not.toBeInTheDocument();
    // …and not the misleading "—"-valued stat cards either.
    expect(screen.queryByText("إجمالي الإحالات")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "إعادة المحاولة" })).toBeInTheDocument();
  });

  it("renders the error card on a 5xx error envelope (non-OK is not success)", async () => {
    fetchMock.mockResolvedValue(resLike({ ok: false, status: 500, body: { error: "internal" } }));

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("تعذّر تحميل الإحالات")).toBeInTheDocument();
    });
    expect(screen.queryByText("لا توجد إحالات")).not.toBeInTheDocument();
  });

  it("retry re-fetches and recovers once the API responds", async () => {
    fetchMock
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValue(resLike({ body: referralPayload }));

    renderPage();

    const retry = await screen.findByRole("button", { name: "إعادة المحاولة" });
    fireEvent.click(retry);

    expect(await screen.findByText("إجمالي الإحالات")).toBeInTheDocument();
    // A real list row (referee phone only appears in rows, not the leaderboard).
    expect(await screen.findByText("0922222222")).toBeInTheDocument();
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("still renders the empty state when the load succeeds with zero referrals", async () => {
    fetchMock.mockResolvedValue(resLike({ body: emptyPayload }));

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("لا توجد إحالات")).toBeInTheDocument();
    });
    expect(screen.queryByText("تعذّر تحميل الإحالات")).not.toBeInTheDocument();
  });
});
