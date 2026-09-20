/**
 * 98-F7 (r97 F-10 — deferred queue) — NotificationBell state-integrity tests.
 *
 * The bell's markRead/markAllRead were fire-and-forget with the state
 * flip AFTER the await and NO r.ok check, and fetchAll had no request
 * sequence: a 4xx/5xx or network failure left the badge/rows lying
 * "read" (until a later poll silently reverted them), and a slow poll
 * response landing after a socket-triggered refetch overwrote the
 * fresher list.
 *
 * Contract pinned here:
 *
 *   1. markRead failure (HTTP 500) ⇒ the optimistic flip is rolled back
 *      — the badge and the unread row marker return.
 *   2. markAllRead failure ⇒ the whole list rolls back to the pre-click
 *      truth (read rows stay read, unread rows return unread).
 *   3. fetchAll: a late stale poll response never overwrites a newer
 *      socket-triggered fetch's list.
 *
 * Auth/toast mocked at the module boundary (notification-bell-panel
 * test pattern); fetch routed per URL + method.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Router } from "wouter";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { NotificationBell } from "@/components/layout/NotificationBell";
import { NOTIFICATION_NEW_EVENT } from "@/lib/socket-events";

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

vi.mock("@/hooks/use-toast", () => ({
  toast: vi.fn(),
}));

function resLike(over: { ok?: boolean; status?: number; body?: unknown } = {}) {
  const { ok = true, status = 200, body = {} } = over;
  return { ok, status, json: () => Promise.resolve(body) } as unknown as Response;
}

function notif(id: number, title: string, isRead: boolean) {
  return {
    id,
    // "order" rows carry an action chip in TYPE_CONFIG — without it the
    // per-row «تحديد كمقروء» chip never renders (the wrapper block keys
    // on actionHref || actionLabel) and the only mark path is the row
    // body, which also navigates.
    type: "order",
    title,
    message: null,
    link: null,
    is_read: isRead,
    created_at: "2026-09-01T10:00:00.000Z",
  };
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function renderBell() {
  return render(
    <Router>
      <NotificationBell />
    </Router>,
  );
}

async function openPanel() {
  fireEvent.click(screen.getByRole("button", { name: "الإشعارات" }));
  return screen.findByRole("dialog", { name: "الإشعارات" });
}

/** The "mark all read" header action only renders while unread > 0 —
 *  a clean, panel-scoped unread proxy (the raw badge "1" also matches
 *  the header count chip once the panel is open). */
const unreadProxy = () => screen.queryByRole("button", { name: "تحديد الكل كمقروء" });

describe("NotificationBell — mark* rollback + fetchAll ordering (r97 F-10)", () => {
  it("a failed markRead (HTTP 500) rolls the row back to unread and the badge count returns", async () => {
    fetchMock.mockImplementation((input: unknown, init?: { method?: string }) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/notifications" && method === "GET") {
        // One read + one unread notification.
        return Promise.resolve(
          resLike({ body: [notif(1, "مقروءة سابقاً", true), notif(2, "غير مقروءة", false)] }),
        );
      }
      if (url.includes("/api/notifications/2/read")) {
        return Promise.resolve(resLike({ ok: false, status: 500, body: { error: "x" } }));
      }
      return Promise.resolve(resLike({ body: [] }));
    });

    renderBell();
    // Unread badge = 1.
    const badge = await screen.findByText("1");
    expect(badge).toBeInTheDocument();

    await openPanel();
    const markButton = screen.getByRole("button", { name: "تحديد كمقروء" });
    fireEvent.click(markButton);

    // Optimistic flip: every unread surface disappears (badge, header
    // count chip, per-row chips, the mark-all action)…
    await waitFor(() => {
      expect(unreadProxy()).not.toBeInTheDocument();
      expect(screen.queryByText("1")).not.toBeInTheDocument();
    });
    // …then the 500 lands and the pre-click truth returns everywhere.
    await waitFor(() => {
      expect(unreadProxy()).toBeInTheDocument();
      expect(screen.getAllByText("1").length).toBeGreaterThanOrEqual(1);
    });
    // The row itself is unread again (its mark-as-read chip is back).
    expect(screen.getByRole("button", { name: "تحديد كمقروء" })).toBeInTheDocument();
  });

  it("a failed markAllRead rolls the WHOLE list back (read rows stay read, unread returns)", async () => {
    fetchMock.mockImplementation((input: unknown, init?: { method?: string }) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/notifications" && method === "GET") {
        return Promise.resolve(
          resLike({ body: [notif(1, "مقروءة سابقاً", true), notif(2, "غير مقروءة", false)] }),
        );
      }
      if (url === "/api/notifications/read-all") {
        // Network-level failure (offline click).
        return Promise.reject(new TypeError("Failed to fetch"));
      }
      return Promise.resolve(resLike({ body: [] }));
    });

    renderBell();
    await screen.findByText("1");
    await openPanel();

    fireEvent.click(screen.getByRole("button", { name: "تحديد الكل كمقروء" }));

    // Optimistic: everything reads as read — the unread proxy action, the
    // badge and the header count chip are gone…
    await waitFor(() => {
      expect(unreadProxy()).not.toBeInTheDocument();
      expect(screen.queryByText("1")).not.toBeInTheDocument();
    });
    // …and the exact pre-click snapshot is restored on failure (badge +
    // header chip both reappear — getAllByText, they legitimately match
    // the same count).
    await waitFor(() => {
      expect(unreadProxy()).toBeInTheDocument();
      expect(screen.getAllByText("1").length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.getByText("مقروءة سابقاً")).toBeInTheDocument();
    expect(screen.getByText("غير مقروءة")).toBeInTheDocument();
  });

  it("a late stale fetchAll response never overwrites a newer socket-triggered list", async () => {
    fetchMock.mockImplementation((input: unknown, init?: { method?: string }) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/notifications" && method === "GET") {
        // The FIRST call (mount poll) answers SLOWLY with the older list;
        // the socket-triggered refetch answers immediately with the newer
        // one. The older response resolving last must not win.
        if (
          fetchMock.mock.calls.filter((c) => String(c[0]) === "/api/notifications").length === 1
        ) {
          return new Promise<Response>((resolve) => {
            setTimeout(
              () => resolve(resLike({ body: [notif(1, "قائمة قديمة STALE", true)] })),
              500,
            );
          });
        }
        return Promise.resolve(resLike({ body: [notif(9, "قائمة حديثة FRESH", true)] }));
      }
      return Promise.resolve(resLike({ body: [] }));
    });

    renderBell();
    await openPanel();

    // Socket push lands while the mount poll is still in flight →
    // refetch returns the newer list immediately.
    window.dispatchEvent(new Event(NOTIFICATION_NEW_EVENT));
    expect(await screen.findByText("قائمة حديثة FRESH")).toBeInTheDocument();

    // Wait WELL past the older response's 500ms delay — it resolves now,
    // after the newer one, and must be dropped.
    await new Promise((r) => setTimeout(r, 650));
    expect(screen.queryByText("قائمة قديمة STALE")).not.toBeInTheDocument();
    expect(screen.getByText("قائمة حديثة FRESH")).toBeInTheDocument();
  });
});
