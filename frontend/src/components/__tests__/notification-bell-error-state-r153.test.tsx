/**
 * R153 (Phase C) — the bell's honest tri-state.
 *
 * The panel body previously rendered the «لا توجد إشعارات» empty hero
 * UNCONDITIONALLY — before the first response arrived (loading) and on a
 * failed fetch (outage). Both lied: "you have no notifications" is a
 * claim about data the component did not have. This suite pins the R153
 * contract:
 *
 *   1. a FAILED first fetch → the error state (role=alert, retry button),
 *      NEVER the empty state;
 *   2. the retry button re-fetches and lands on the real rows;
 *   3. a fetch that arrives before the panel opens (loading → ok) shows
 *      the empty state ONLY when the server truly answered with zero
 *      rows — the honest empty.
 *
 * Harness: notification-bell-panel.test.tsx (the auth/toast module
 * mocks + real Response objects through customFetch).
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Router } from "wouter";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotificationBell } from "@/components/layout/NotificationBell";

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

vi.mock("@/hooks/use-toast", () => ({
  toast: vi.fn(),
}));

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const NOTIF = (i: number) => ({
  id: i,
  type: "order",
  title: `إشعار رقم ${i}`,
  message: `تفاصيل ${i}`,
  link: "/orders",
  is_read: false,
  created_at: "2026-10-01T10:00:00.000Z",
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.innerWidth = 1024;
});

async function openPanel(): Promise<HTMLElement> {
  render(
    <Router>
      <NotificationBell />
    </Router>,
  );
  fireEvent.click(screen.getByRole("button", { name: /الإشعارات/ }));
  return (await screen.findByRole("dialog", { name: "الإشعارات" })) as HTMLElement;
}

describe("R153 — the bell panel tri-state (loading / error / ok)", () => {
  it("a FAILED first fetch shows the error state with a retry, never «لا توجد إشعارات»", async () => {
    // Every /api/notifications call rejects (network-down class).
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const panel = await openPanel();

    // The outage surfaces as an alert region — NOT the empty hero.
    const alert = await waitFor(() => {
      const el = panel.querySelector('[role="alert"]');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    expect(alert.textContent).toContain("تعذّر تحميل الإشعارات");
    expect(panel.textContent).not.toContain("لا توجد إشعارات");

    // The retry affordance is present and rides the 44px floor.
    const retry = screen.getByRole("button", { name: /إعادة المحاولة/ });
    expect(retry.className).toContain("min-h-11");
  });

  it("the retry button recovers to the real rows", async () => {
    let fail = true;
    const fetchMock = vi.fn(async () =>
      fail
        ? Promise.reject(new TypeError("Failed to fetch"))
        : Promise.resolve(jsonResponse([NOTIF(1), NOTIF(2)])),
    );
    vi.stubGlobal("fetch", fetchMock);
    await openPanel();

    const retry = await screen.findByRole("button", { name: /إعادة المحاولة/ });
    fail = false;
    fireEvent.click(retry);

    // The rows land and the error state is gone.
    await waitFor(() => {
      expect(screen.getByText("إشعار رقم 1")).toBeTruthy();
      expect(screen.getByText("إشعار رقم 2")).toBeTruthy();
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a SUCCESSFUL zero-row answer still shows the honest empty state", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse([])));
    const panel = await openPanel();

    await waitFor(() => {
      expect(panel.textContent).toContain("لا توجد إشعارات");
    });
    // Not an error, not a loading guess — the honest empty.
    expect(panel.querySelector('[role="alert"]')).toBeNull();
    expect(panel.querySelector('[role="status"]')).toBeNull();
  });

  it("a later poll failure KEEPS the stale rows on screen (silent reconcile contract)", async () => {
    let ok = true;
    const fetchMock = vi.fn(async () =>
      ok
        ? Promise.resolve(jsonResponse([NOTIF(7)]))
        : Promise.reject(new TypeError("Failed to fetch")),
    );
    vi.stubGlobal("fetch", fetchMock);
    await openPanel();

    // First fetch landed the row.
    await waitFor(() => expect(screen.getByText("إشعار رقم 7")).toBeTruthy());

    // The next 60 s poll fails — the stale list stays; an outage must
    // not blank data we already hold (fake timers drive the interval).
    ok = false;
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      vi.advanceTimersByTime(61_000);
      await waitFor(() => {
        // The rows survive the failed poll and no error region appears.
        expect(screen.getByText("إشعار رقم 7")).toBeTruthy();
        expect(screen.queryByRole("alert")).toBeNull();
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
