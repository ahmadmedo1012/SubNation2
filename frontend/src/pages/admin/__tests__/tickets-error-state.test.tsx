/**
 * B5-04 + B5-14 (round-92 audit) — tickets load-failure tests.
 *
 * `fetchTickets` had `.catch(() => {})`: a failed support-queue load
 * rendered the false "لا توجد تذاكر" empty state — an admin on a flaky
 * network silently believed the queue was empty. `openTicket`
 * additionally had no `res.ok` check and was invoked unawaited, turning
 * detail-fetch failures into unhandled rejections (B5-14, P2). These
 * tests pin:
 *
 *   1. Network failure ⇒ the distinct error card with a retry button
 *      (storefront idiom), NEVER the "no tickets" empty state.
 *   2. Non-OK HTTP (401 envelope) ⇒ same error card.
 *   3. Retry re-fetches and recovers the queue.
 *   4. A successful load with zero tickets still renders the true
 *      empty state.
 *   5. A failing detail fetch toasts an error instead of throwing an
 *      unhandled rejection, and the detail pane stays closed.
 *
 * `@/lib/auth`, the admin shell and the toast hook are mocked at the
 * module boundary (vitest-config pattern).
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ReactNode } from "react";
import AdminTicketsPage from "@/pages/admin/tickets";

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

const ticketSummary = {
  id: 1,
  user_phone: "0911111111",
  user_display_name: null,
  user_email: null,
  user_auth_provider: null,
  title: "مشكلة في الشحن",
  category: "billing",
  status: "open",
  created_at: "2026-09-01T10:00:00.000Z",
  reply_count: 0,
  last_reply_at: null,
  has_unread_admin: false,
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
  // R120-B5 (A2-F9): the queue rides useInfiniteQuery now — a fresh
  // client per render (retry: false) per the page-test convention.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Router>
        <AdminTicketsPage />
      </Router>
    </QueryClientProvider>,
  );
}

describe("AdminTicketsPage — a failed queue load is an error, not a false empty state (B5-04)", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the error card with a retry action when the queue fetch fails", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("تعذّر تحميل التذاكر")).toBeInTheDocument();
    });
    // Crucially NOT the "queue is empty" state — an outage is not "no tickets".
    expect(screen.queryByText("لا توجد تذاكر")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "إعادة المحاولة" })).toBeInTheDocument();
  });

  it("renders the error card on a 401 error envelope", async () => {
    fetchMock.mockResolvedValue(
      resLike({ ok: false, status: 401, body: { error: "انتهت الجلسة" } }),
    );

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("تعذّر تحميل التذاكر")).toBeInTheDocument();
    });
    expect(screen.queryByText("لا توجد تذاكر")).not.toBeInTheDocument();
  });

  it("retry re-fetches and recovers the queue once the API responds", async () => {
    fetchMock
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValue(resLike({ body: [ticketSummary] }));

    renderPage();

    const retry = await screen.findByRole("button", { name: "إعادة المحاولة" });
    fireEvent.click(retry);

    expect(await screen.findByText("مشكلة في الشحن")).toBeInTheDocument();
    expect(screen.queryByText("تعذّر تحميل التذاكر")).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("still renders the empty state when the queue loads successfully with zero tickets", async () => {
    fetchMock.mockResolvedValue(resLike({ body: [] }));

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("لا توجد تذاكر")).toBeInTheDocument();
    });
    expect(screen.queryByText("تعذّر تحميل التذاكر")).not.toBeInTheDocument();
  });

  it("a failing detail fetch toasts an error instead of an unhandled rejection (B5-14)", async () => {
    fetchMock.mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url === "/api/admin/tickets/1") {
        return resLike({ ok: false, status: 500, body: { error: "خطأ في الخادم" } });
      }
      return resLike({ body: [ticketSummary] });
    });

    renderPage();

    const card = await screen.findByText("مشكلة في الشحن");
    fireEvent.click(card.closest("button")!);

    await waitFor(() => expect(toastMock).toHaveBeenCalledTimes(1));
    const toastArg = toastMock.mock.calls[0][0];
    expect(toastArg.variant).toBe("destructive");
    expect(String(toastArg.description)).toContain("خطأ في الخادم");
    // The detail pane never opened — the placeholder is still showing.
    expect(screen.getByText("اختر تذكرة للعرض")).toBeInTheDocument();
  });
});
