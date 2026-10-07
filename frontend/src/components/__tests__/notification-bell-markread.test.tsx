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
 * R118-B6 (A5 W-6): migrated to vi.useFakeTimers — the stale-poll race
 * used to sleep a real 650ms (top flake candidate on a loaded 2-CPU
 * runner). The repo's established fake-timer idiom
 * (whatsapp-phone-sign-in.test.tsx): advance via
 * act(vi.advanceTimersByTime) + a microtask flush; NEVER waitFor/findBy
 * (they poll on faked timers and hang). The mount poll's 500ms delayed
 * response is a fake timer now, so "the older response resolves after
 * the newer one" is driven deterministically.
 *
 * Auth/toast mocked at the module boundary (notification-bell-panel
 * test pattern); fetch routed per URL + method.
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
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

/** Drains the promise continuations behind the mocked fetch (fake timers freeze macrotasks). */
async function flushAsync() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

/** Advances fake time, then drains whatever the fired timers started. */
async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
  await flushAsync();
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.useFakeTimers();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function renderBell() {
  return render(
    <Router>
      <NotificationBell />
    </Router>,
  );
}

function openPanel() {
  // R120-B1 (A4-F7): the bell's accessible name now carries the unread
  // count («الإشعارات، 2 إشعارات غير مقروءة») — regex match, exact
  // string would miss every state with unread > 0.
  fireEvent.click(screen.getByRole("button", { name: /الإشعارات/ }));
  // The portal'd panel renders in the same commit as the click — no
  // findBy needed (and none possible: it polls on faked timers).
  return screen.getByRole("dialog", { name: "الإشعارات" });
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
    // The mount fetchAll settles on the microtask queue — drain it and
    // the unread badge ("1") is there, deterministically.
    await flushAsync();
    const badge = screen.getByText("1");
    expect(badge).toBeInTheDocument();

    openPanel();
    const markButton = screen.getByRole("button", { name: "تحديد كمقروء" });
    fireEvent.click(markButton);

    // Optimistic flip: every unread surface disappears (badge, header
    // count chip, per-row chips, the mark-all action) — synchronously
    // with the click, before the request is even awaited…
    expect(unreadProxy()).not.toBeInTheDocument();
    expect(screen.queryByText("1")).not.toBeInTheDocument();
    // …then the 500 lands (microtask flush) and the pre-click truth
    // returns everywhere.
    await flushAsync();
    expect(unreadProxy()).toBeInTheDocument();
    expect(screen.getAllByText("1").length).toBeGreaterThanOrEqual(1);
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
    await flushAsync();
    expect(screen.getByText("1")).toBeInTheDocument();
    openPanel();

    fireEvent.click(screen.getByRole("button", { name: "تحديد الكل كمقروء" }));

    // Optimistic: everything reads as read — the unread proxy action, the
    // badge and the header count chip are gone…
    expect(unreadProxy()).not.toBeInTheDocument();
    expect(screen.queryByText("1")).not.toBeInTheDocument();
    // …and the exact pre-click snapshot is restored on failure (badge +
    // header chip both reappear — getAllByText, they legitimately match
    // the same count).
    await flushAsync();
    expect(unreadProxy()).toBeInTheDocument();
    expect(screen.getAllByText("1").length).toBeGreaterThanOrEqual(1);
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
    // The mount poll (call 1) is in flight, pending on its 500ms fake
    // timer — the panel opens against the still-empty list.
    openPanel();

    // Socket push lands while the mount poll is still in flight →
    // refetch returns the newer list immediately.
    window.dispatchEvent(new Event(NOTIFICATION_NEW_EVENT));
    await flushAsync();
    expect(screen.getByText("قائمة حديثة FRESH")).toBeInTheDocument();

    // Advance WELL past the older response's 500ms delay — it resolves
    // now, after the newer one, and must be dropped (seq guard).
    await advance(500);
    expect(screen.queryByText("قائمة قديمة STALE")).not.toBeInTheDocument();
    expect(screen.getByText("قائمة حديثة FRESH")).toBeInTheDocument();
  });
});
