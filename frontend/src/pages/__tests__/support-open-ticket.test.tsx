/**
 * Support page resilience tests — 93-C5 / F-05 (A4 P2 #6, A10 spec (g)).
 *
 * 1. openTicket had NO res.ok / shape guard: a 401/5xx envelope {error}
 *    was set as `selectedTicket`, the render path dereferenced
 *    `selectedTicket.replies.length` and the TypeError took the whole
 *    page down to the route-level ErrorBoundary. Clicking any ticket
 *    during a session expiry / API blip nuked the page. Now: error toast
 *    + page stays mounted.
 * 2. fetchTickets had no res.ok check: a failed list fetch fell through
 *    to the "لا توجد تذاكر دعم" empty state — an outage masquerading as
 *    "no tickets" (the exact error-as-empty class round-92 claimed
 *    closed for tickets). Now: distinct error card with retry.
 *
 * `fetch` is stubbed per-test (support.tsx uses raw fetch, not the
 * orval client); `@/lib/auth` and `@/hooks/use-toast` are mocked at the
 * module boundary.
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
      author_type: "user",
      message: "لم أستلم بيانات الحساب",
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

describe("SupportPage — failures are errors, never crashes or fake empties (93-C5 F-05)", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    toastSpy.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    // jsdom doesn't implement scrollIntoView — the ticket thread auto-scroll
    // (support.tsx) needs it as a no-op.
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("a 5xx ticket-detail response no longer crashes the page (openTicket guard)", async () => {
    // List loads fine; the detail fetch explodes with an error envelope —
    // the historical bug fed {error} into selectedTicket and the render
    // crashed at `selectedTicket.replies.length`.
    fetchMock
      .mockResolvedValueOnce(resLike({ body: TICKET_LIST }))
      .mockResolvedValueOnce(resLike({ ok: false, status: 500, body: { error: "internal" } }));

    renderPage();

    // Wait for the list, then open the ticket.
    const row = await screen.findByText("مشكلة في الطلب");
    fireEvent.click(row);

    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "تعذّر تحميل التذكرة",
          variant: "destructive",
        }),
      );
    });
    // The page is STILL MOUNTED — no TypeError → no ErrorBoundary.
    expect(screen.getByText("الدعم الفني")).toBeInTheDocument();
    // The detail view never opened — the list is still rendered.
    expect(row).toBeInTheDocument();
  });

  it("a successful detail fetch still opens the ticket thread (guard is not over-strict)", async () => {
    fetchMock
      .mockResolvedValueOnce(resLike({ body: TICKET_LIST }))
      .mockResolvedValueOnce(resLike({ body: TICKET_DETAIL }));

    renderPage();

    fireEvent.click(await screen.findByText("مشكلة في الطلب"));

    // The reply from the thread is rendered — the happy path is intact.
    await waitFor(() => {
      expect(screen.getByText("لم أستلم بيانات الحساب")).toBeInTheDocument();
    });
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it("a failed list fetch renders the error card with retry, not the empty state", async () => {
    fetchMock.mockResolvedValueOnce(
      resLike({ ok: false, status: 500, body: { error: "internal" } }),
    );

    renderPage();

    expect(await screen.findByText("تعذّر تحميل التذاكر")).toBeInTheDocument();
    // Crucially NOT the "no tickets" empty state — the outage used to
    // masquerade as an empty ticket history.
    expect(screen.queryByText("لا توجد تذاكر دعم")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "إعادة المحاولة" })).toBeInTheDocument();
  });

  it("still renders the empty state when the list succeeds with zero tickets", async () => {
    fetchMock.mockResolvedValueOnce(resLike({ body: [] }));

    renderPage();

    expect(await screen.findByText("لا توجد تذاكر دعم")).toBeInTheDocument();
    expect(screen.queryByText("تعذّر تحميل التذاكر")).not.toBeInTheDocument();
  });
});
