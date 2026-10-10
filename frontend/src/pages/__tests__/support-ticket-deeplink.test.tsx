/**
 * R126-L6 (A9-1) — /support?ticket=<id> deep-link continuation.
 *
 * The backend's reply notification used to carry a bare /support link
 * (admin/tickets.ts now sends /support?ticket=<id>), and the page read
 * only ?ref= — so every "رد جديد على تذكرتك" tap dumped the customer
 * on the ticket LIST to visually find the thread. Orders and topups
 * deep-link to their entity; the support page now reads ?ticket= and
 * auto-opens the thread once the authed list resolves.
 *
 * Pinned here:
 *   • mount at /support?ticket=1 (authed, list contains id 1) ⇒ the
 *     ticket detail is fetched and the thread AUTO-OPENS (zero taps);
 *   • a foreign id (?ticket=999, not in the user's list) is a silent
 *     no-op — no detail fetch, no error toast, the list stays;
 *   • a malformed ?ticket= value is ignored entirely;
 *   • B13 minor-2 (R128-IMP-5): a FAILED first list fetch does NOT
 *     consume the link — the error state's empty `tickets` array used
 *     to fail the membership check and eat the deep link on an outage;
 *     the link stays armed and a successful retry still opens the
 *     thread.
 *
 * Harness: support-open-ticket.test.tsx — raw fetch stubbed per-test
 * (support.tsx uses plain fetch, not the orval client).
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Router } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SupportPage from "@/pages/support";

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

const toastSpy = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastSpy }),
}));

function resLike(over: { ok?: boolean; status?: number; body?: unknown } = {}) {
  const { ok = true, status = 200, body = {} } = over;
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

const fetchMock = vi.fn();

const TICKET_LIST = [
  {
    id: 1,
    title: "مشكلة في الطلب",
    category: "order",
    status: "open",
    created_at: new Date(Date.now() - 3600_000).toISOString(),
    last_reply: null,
  },
];

const TICKET_DETAIL = {
  id: 1,
  title: "مشكلة في الطلب",
  category: "order",
  status: "open",
  created_at: new Date(Date.now() - 3600_000).toISOString(),
  last_reply: null,
  replies: [
    {
      id: 11,
      author_type: "admin",
      message: "رد الدعم وصل هنا",
      created_at: new Date(Date.now() - 1800_000).toISOString(),
    },
  ],
};

function renderPage() {
  return render(
    <Router>
      <SupportPage />
    </Router>,
  );
}

describe("SupportPage — ?ticket= deep link auto-opens the thread (A9-1, R126-L6)", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    toastSpy.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    Element.prototype.scrollIntoView = vi.fn();
    window.history.pushState(null, "", "/support");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.pushState(null, "", "/support");
  });

  it("mounts at ?ticket=1: the thread AUTO-OPENS once the list resolves (zero taps)", async () => {
    window.history.pushState(null, "", "/support?ticket=1");
    fetchMock
      .mockResolvedValueOnce(resLike({ body: TICKET_LIST }))
      .mockResolvedValueOnce(resLike({ body: TICKET_DETAIL }));

    renderPage();

    // The detail fetch fired WITHOUT any click (the continuation the
    // notification link promises)…
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/support/tickets/1",
        expect.objectContaining({
          headers: { Authorization: "Bearer test-token" },
        }),
      );
    });
    // …and the thread renders the admin reply the notification was about.
    await waitFor(() => {
      expect(screen.getByText("رد الدعم وصل هنا")).toBeInTheDocument();
    });
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it("a foreign ticket id is a silent no-op: no detail fetch, no toast, the list stays", async () => {
    window.history.pushState(null, "", "/support?ticket=999");
    fetchMock.mockResolvedValue(resLike({ body: TICKET_LIST }));

    renderPage();

    // The list loads…
    await waitFor(() => {
      expect(screen.getByText("مشكلة في الطلب")).toBeInTheDocument();
    });
    // …but only the LIST endpoint was ever hit — no /tickets/999 probe,
    // no error toast for a ticket the user doesn't own.
    await new Promise((r) => setImmediate(r));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/support/tickets");
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it("a malformed ?ticket= value is ignored entirely (no detail fetch)", async () => {
    window.history.pushState(null, "", "/support?ticket=abc");
    fetchMock.mockResolvedValue(resLike({ body: TICKET_LIST }));

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("مشكلة في الطلب")).toBeInTheDocument();
    });
    await new Promise((r) => setImmediate(r));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/support/tickets");
  });

  it("a FAILED first list fetch does not consume the link — a successful retry still opens the thread (B13 minor-2, R128-IMP-5)", async () => {
    window.history.pushState(null, "", "/support?ticket=1");
    // 1st call: the list fetch dies (outage) → error card, tickets=[].
    // 2nd: the retry succeeds. 3rd: the armed link opens the thread.
    fetchMock
      .mockResolvedValueOnce(resLike({ ok: false, status: 500, body: { error: "internal" } }))
      .mockResolvedValueOnce(resLike({ body: TICKET_LIST }))
      .mockResolvedValueOnce(resLike({ body: TICKET_DETAIL }));

    renderPage();

    // The outage is an error card, NOT the empty state — and the deep
    // link must NOT be consumed against the error state's empty list
    // (the pre-fix membership check ate it right here).
    expect(await screen.findByText("تعذّر تحميل التذاكر")).toBeInTheDocument();
    expect(screen.queryByText("لا توجد تذاكر دعم")).not.toBeInTheDocument();

    // The FetchErrorCard retry refetches the list; the STILL-ARMED link
    // now opens the thread the notification promised.
    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));

    await waitFor(() => {
      expect(screen.getByText("رد الدعم وصل هنا")).toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/support/tickets/1",
      expect.objectContaining({
        headers: { Authorization: "Bearer test-token" },
      }),
    );
    expect(toastSpy).not.toHaveBeenCalled();
  });
});
