/**
 * A9-F2 (R128-IMP-5) — the /notifications page.
 *
 * The bell panel is a 40-row window (and honestly says «آخر 40 إشعاراً»
 * at the cap); this page is the ?page= consumer that walks past it.
 *
 * Pinned here (harness: orders-load-more.test.tsx — real QueryClient +
 * the mocked global fetch over the raw paged URL):
 *   • the first page is requested as ?page=1&limit=20;
 *   • the count badge states the TRUE total the envelope carries —
 *     «عرض X من Y» while pages remain, the plain count at the end;
 *   • «تحميل المزيد» appends the next page, DEDUPS a row repeated
 *     across pages (offset shifts when a notification lands mid-browse),
 *     and hides once hasMore is false (the server's honest end);
 *   • a single short page → plain badge, no load-more;
 *   • a failed fetch surfaces the error card, never the empty state;
 *   • mark-read rides the bell's optimistic contract: the per-row
 *     «تحديد كمقروء» fires POST /:id/read and flips instantly, and
 *     «تحديد الكل كمقروء» fires POST /read-all and clears every row.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import NotificationsPage from "@/pages/notifications";
import { formatCount } from "@/lib/utils";

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

const NOTIFICATION_COUNT_FORMS = {
  one: "إشعار",
  two: "إشعاران",
  few: "إشعارات",
  many: "إشعاراً",
  other: "إشعار",
} as const;

const NOTIF = (i: number, over: Record<string, unknown> = {}) => ({
  id: i,
  type: "order",
  title: `إشعار رقم ${i}`,
  message: `تفاصيل الإشعار ${i}`,
  link: `/orders`,
  is_read: false,
  created_at: "2026-10-01T10:00:00.000Z",
  ...over,
});

/** The paged envelope (GET /api/notifications?page=N&limit=20). */
function envelope(rows: ReturnType<typeof NOTIF>[], total: number, hasMore: boolean) {
  return { notifications: rows, total, page: 1, limit: 20, hasMore };
}

/** Minimal Response-like object — avoids depending on a global Response
 * (the orders-load-more.test.tsx idiom). */
const jsonRes = (body: unknown, ok = true, status = 200) =>
  ({ ok, status, json: async () => body }) as Response;

const fetchMock = vi.fn<typeof fetch>();
let pageOne: ReturnType<typeof envelope> | null = null;
let pageTwo: ReturnType<typeof envelope> | null = null;

beforeEach(() => {
  pageOne = envelope(
    Array.from({ length: 20 }, (_, i) => NOTIF(i + 1)),
    45,
    true,
  );
  // 3 rows, one of which repeats page 1's id=1 → dedup leaves 2 new
  // (20 + 2 = 22 distinct). The server's page-2 count is the fresher
  // truth: 22 total, no more pages.
  pageTwo = envelope([NOTIF(21), NOTIF(1), NOTIF(22)], 22, false);
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    return jsonRes(url.includes("page=2") ? pageTwo : pageOne);
  });
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

describe("NotificationsPage — A9-F2 paged history (R128-IMP-5)", () => {
  it("requests ?page=1&limit=20 and states the TRUE total while pages remain", async () => {
    renderPage();

    expect(await screen.findByText("إشعار رقم 1")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/notifications?page=1&limit=20");
    // The envelope carries the total — the badge is «عرض X من Y», never
    // a guess (the orders plain-array contract could only say «عرض X»).
    expect(
      screen.getByText(
        `عرض ${formatCount(20, NOTIFICATION_COUNT_FORMS)} من ${formatCount(
          45,
          NOTIFICATION_COUNT_FORMS,
        )}`,
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /تحميل المزيد/ })).toBeInTheDocument();
  });

  it("load-more appends page 2, dedups repeated rows, and hides at the server's honest end", async () => {
    renderPage();

    const loadMore = await screen.findByRole("button", { name: /تحميل المزيد/ });
    fireEvent.click(loadMore);

    // Page 2 carried 3 rows but one repeats id=1 → 20 + 2 = 22 shown.
    await waitFor(() => expect(screen.getByText("إشعار رقم 22")).toBeInTheDocument());
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toBe("/api/notifications?page=2&limit=20");
    // hasMore=false on the last page → no more load-more…
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /تحميل المزيد/ })).not.toBeInTheDocument(),
    );
    // …and every row is now loaded, so the badge drops the «عرض X من»
    // qualifier and states the plain total (22 distinct rows).
    expect(screen.getByText(formatCount(22, NOTIFICATION_COUNT_FORMS))).toBeInTheDocument();
  });

  it("a single SHORT page keeps the plain count badge and no load-more", async () => {
    pageOne = envelope([NOTIF(1), NOTIF(2), NOTIF(3)], 3, false);
    renderPage();

    expect(await screen.findByText("إشعار رقم 3")).toBeInTheDocument();
    expect(screen.getByText(formatCount(3, NOTIFICATION_COUNT_FORMS))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /تحميل المزيد/ })).not.toBeInTheDocument();
  });

  it("a failed fetch surfaces the error card, never the empty state", async () => {
    fetchMock.mockImplementation(async () =>
      jsonRes({ error: "انتهت الجلسة", code: "UNAUTHORIZED" }, false, 401),
    );
    renderPage();

    expect(await screen.findByText("تعذّر تحميل الإشعارات")).toBeInTheDocument();
    expect(screen.queryByText("لا توجد إشعارات")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "إعادة المحاولة" })).toBeInTheDocument();
  });

  it("per-row mark-read is optimistic (POST /:id/read flips the row instantly)", async () => {
    pageOne = envelope([NOTIF(1, { is_read: true }), NOTIF(2)], 2, false);
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/read")) return jsonRes({ success: true });
      return jsonRes(pageOne);
    });
    renderPage();

    // Row 1 is already read (no button); row 2 is unread.
    const buttons = await screen.findAllByRole("button", { name: "تحديد كمقروء" });
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/notifications/2/read",
        expect.objectContaining({ method: "POST" }),
      );
    });
    // Optimistic flip: the row's affordance disappears immediately.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "تحديد كمقروء" })).not.toBeInTheDocument(),
    );
  });

  it("«تحديد الكل كمقروء» fires POST /read-all and clears every unread row", async () => {
    pageOne = envelope([NOTIF(1), NOTIF(2), NOTIF(3)], 3, false);
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/read-all")) return jsonRes({ success: true });
      return jsonRes(pageOne);
    });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /تحديد الكل كمقروء/ }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/notifications/read-all",
        expect.objectContaining({ method: "POST" }),
      );
    });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "تحديد كمقروء" })).not.toBeInTheDocument(),
    );
    // The header's bulk affordance disappears with the last unread row.
    expect(screen.queryByRole("button", { name: /تحديد الكل كمقروء/ })).not.toBeInTheDocument();
  });

  it("an unread row tap marks it read and follows its deep link", async () => {
    pageOne = envelope([NOTIF(1)], 1, false);
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/read")) return jsonRes({ success: true });
      return jsonRes(pageOne);
    });
    renderPage();

    // The row BODY (not just the action chip) is the open affordance.
    fireEvent.click(await screen.findByRole("button", { name: "إشعار رقم 1 — افتح" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/notifications/1/read",
        expect.objectContaining({ method: "POST" }),
      );
    });
    expect(window.location.pathname).toBe("/orders");
  });
});
