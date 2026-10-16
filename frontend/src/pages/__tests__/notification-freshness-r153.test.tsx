/**
 * R153 (Phase C) — notification freshness while mounted.
 *
 * Two confirmed staleness defects, pinned here:
 *
 *   1. The /notifications page fetched ONCE per mount: no poll, no
 *      NOTIFICATION_NEW_EVENT listener, no entry in the reconnect-resync
 *      family set, and refetchOnWindowFocus is off app-wide — a user
 *      sitting on the page never saw a new row until a remount. The
 *      R153 fix rides the bell's own contract: a 60 s refetchInterval +
 *      an immediate refetch on NOTIFICATION_NEW_EVENT (the socket
 *      accelerator, active wherever a socket-bearing page is mounted
 *      in the tab).
 *
 *   2. The admin alert toast poller had no in-flight guard and no
 *      stable toast ids — the socket event + the interval + the
 *      visibility catch-up could overlap and double-toast the same
 *      alerts; and a burst >50 alerts advanced lastId past alerts the
 *      operator never saw. The R153 poller guards re-entry, stamps
 *      `admin-alert-<id>` toast ids, and loops until a short page.
 *
 * Harness: notifications-page.test.tsx / admin-layout-alerts.test.tsx
 * idioms (real QueryClient, mocked global fetch, module mocks).
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import NotificationsPage from "@/pages/notifications";
import { NOTIFICATION_NEW_EVENT } from "@/lib/socket-events";

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

const NOTIF = (i: number, over: Record<string, unknown> = {}) => ({
  id: i,
  type: "order",
  title: `إشعار رقم ${i}`,
  message: `تفاصيل الإشعار ${i}`,
  link: "/orders",
  is_read: false,
  created_at: "2026-10-01T10:00:00.000Z",
  ...over,
});

function envelope(rows: ReturnType<typeof NOTIF>[], total: number, hasMore: boolean) {
  return { notifications: rows, total, page: 1, limit: 20, hasMore };
}

const jsonRes = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => jsonRes(envelope([NOTIF(1)], 1, false)));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.pushState(null, "", "/");
});

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <Router>
        <NotificationsPage />
      </Router>
    </QueryClientProvider>,
  );
}

describe("R153 — /notifications stays fresh while mounted", () => {
  it("a NOTIFICATION_NEW_EVENT refetches the page immediately (the socket accelerator)", async () => {
    renderPage();
    await screen.findByText("إشعار رقم 1");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // A new notification landed while the page was open.
    fetchMock.mockImplementation(async () => jsonRes(envelope([NOTIF(2), NOTIF(1)], 2, false)));
    fireEvent(window, new Event(NOTIFICATION_NEW_EVENT));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(screen.getByText("إشعار رقم 2")).toBeTruthy();
    });
  });

  it("the 60 s refetchInterval pulls the next poll (visible-tab gating is react-query's default)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderPage();
      await screen.findByText("إشعار رقم 1");
      expect(fetchMock).toHaveBeenCalledTimes(1);

      fetchMock.mockImplementation(async () => jsonRes(envelope([NOTIF(3), NOTIF(1)], 2, false)));
      // Advance past the 60 s interval.
      vi.advanceTimersByTime(61_000);

      await waitFor(() => {
        expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
      });
      await waitFor(() => {
        expect(screen.getByText("إشعار رقم 3")).toBeTruthy();
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
