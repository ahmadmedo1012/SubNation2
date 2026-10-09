/**
 * R125-I4 (A4-B-6) + A10 §C-8 — risk events has-more load-more tests.
 *
 * The backend ships a REAL has-more envelope for /api/admin/risk/events
 * (`next_cursor` — the limit+1 probe verdict, backend risk.ts:193-196),
 * but the frontend ignored it: a fixed `limit=100` useQuery with no
 * load-more meant events #101+ were unreachable in the UI forever (the
 * page even displayed a "newest 100 only" notice instead of an
 * affordance to go deeper).
 *
 * The page now accumulates cursor pages in place (the
 * orders/users/tickets recipe). These tests pin:
 *
 *   1. A non-null next_cursor offers «تحميل المزيد».
 *   2. Clicking it fetches WITH the cursor param and appends page 2
 *      in place (existing rows stay, new rows land).
 *   3. A null next_cursor (the short page) hides the button — the
 *      definite end.
 *
 * `@/lib/auth` + the admin shell are mocked at the module boundary
 * (vitest-config pattern); adminFetchJson rides the stubbed global
 * fetch.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ReactNode } from "react";
import AdminRiskPage from "@/pages/admin/risk";

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    adminToken: "test-admin-token",
    hasAdminPermission: () => true,
  }),
}));

vi.mock("@/pages/admin/layout", () => ({
  AdminLayout: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

const DASHBOARD = {
  window_hours: 24,
  total: 3,
  by_level: { low: 0, medium: 3, high: 0, critical: 0 },
  unresolved: 0,
  top_rules: [],
  pipeline: { enabled: true },
};

const EVENT = (id: number) => ({
  id,
  user_id: 7,
  user_phone: "0912345678",
  user_email: null,
  event_type: `rule_${id}`,
  score: 42,
  level: "medium",
  confidence: 0.87,
  rule_fired: ["many_topups"],
  action_taken: "flag",
  ip_address: null,
  created_at: "2026-09-08T10:00:00.000Z",
  shown_at: null,
});

/** Cursor envelope: page 1 has more (non-null cursor), page 2 is the end. */
const PAGE_ONE = { events: [EVENT(1), EVENT(2)], next_cursor: "2026-09-08T10:00:00.000Z:2" };
const PAGE_TWO = { events: [EVENT(3)], next_cursor: null };

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

describe("AdminRiskPage — hasMore envelope drives the load-more (A4-B-6)", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("a non-null next_cursor offers تحميل المزيد; page 2 appends in place and ends the list", async () => {
    fetchMock.mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/risk/dashboard")) return resLike(DASHBOARD);
      if (url.includes("cursor=")) return resLike(PAGE_TWO);
      return resLike(PAGE_ONE);
    });

    renderPage();

    const more = await screen.findByRole("button", { name: /تحميل المزيد/ });
    expect(more).toBeInTheDocument();

    fireEvent.click(more);

    // The page-2 request rides the cursor from the envelope.
    await waitFor(() => {
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("cursor=2026-09-08T10"))).toBe(
        true,
      );
    });

    // Appended in place: event 3 lands, events 1-2 stay.
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "فتح تحقيق الحدث رقم 3" })).toBeInTheDocument();
    });
    expect(screen.getByRole("link", { name: "فتح تحقيق الحدث رقم 1" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "فتح تحقيق الحدث رقم 2" })).toBeInTheDocument();
    // next_cursor went null — the definite end hides the button.
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /تحميل المزيد/ })).not.toBeInTheDocument();
    });
  });

  it("a null next_cursor (short page) never offers the button", async () => {
    fetchMock.mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/risk/dashboard")) return resLike(DASHBOARD);
      return resLike({ events: [EVENT(1)], next_cursor: null });
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "فتح تحقيق الحدث رقم 1" })).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: /تحميل المزيد/ })).not.toBeInTheDocument();
  });
});
