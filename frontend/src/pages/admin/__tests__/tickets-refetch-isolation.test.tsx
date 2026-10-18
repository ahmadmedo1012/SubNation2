/**
 * R151 — tickets: primary-vs-refetch conflation (handleReply + handleStatus).
 *
 * Both handlers awaited `openTicket(id)` (a GET detail refresh) INSIDE the
 * same try/catch as the primary mutation (POST reply / PATCH status). A
 * network blip on the refresh after a SUCCESSFUL primary surfaced as a
 * red «خطأ» toast:
 *   - handleReply: the draft was already cleared (setReplyText("") ran
 *     before the failing await), so the operator lost the drafted text
 *     AND could not tell whether the reply was sent — a natural retype
 *     + resubmit created a DUPLICATE customer-facing reply (the reply
 *     endpoint has no idempotency middleware).
 *   - handleStatus: a successful status flip showed as a failure, and
 *     the success toast never fired (it sat after the failing await).
 *
 * Fix under test: the openTicket refetch is isolated in its own
 * best-effort try/catch — a refresh failure is NOT a primary-mutation
 * failure. The draft clears + the success toast fires based ONLY on
 * the primary mutation's outcome.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type ReactNode } from "react";
import AdminTicketsPage from "@/pages/admin/tickets";

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    adminToken: "test-admin-token",
    hasAdminPermission: () => true,
  }),
}));

vi.mock("@/pages/admin/layout", () => ({
  AdminLayout: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));
vi.mock("@/hooks/useToast", () => ({
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

const ticketDetail = {
  ...ticketSummary,
  body: "الطلب لم يصل بعد",
  replies: [],
};

/** Minimal Response-like object — positional body (matches the working
 *  tickets-error-state.test.tsx harness shape). */
function resLike(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    text: () => Promise.resolve(JSON.stringify(body ?? null)),
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

const fetchMock = vi.fn();

// jsdom doesn't implement scrollIntoView — the detail pane's mount effect
// calls it on open. Same workaround as the existing tickets tests.
beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn();
  }
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Router>
        <AdminTicketsPage />
      </Router>
    </QueryClientProvider>,
  );
}

async function openFirstTicket() {
  await screen.findByText("مشكلة في الشحن");
  fireEvent.click(screen.getByText("مشكلة في الشحن").closest("button")!);
  await waitFor(() => {
    expect(screen.getByPlaceholderText("اكتب ردك هنا…")).toBeInTheDocument();
  });
}

describe("R151 — tickets: refresh failure is not a primary-mutation failure", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    toastMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("handleReply: a refresh failure after a successful reply keeps the success path (no destructive toast)", async () => {
    // First detail GET (open) succeeds; the refresh after reply fails (500).
    let detailCallCount = 0;
    fetchMock.mockImplementation(async (input: unknown, init?: RequestInit) => {
      const url = String(input).split("?")[0];
      const method = (init?.method ?? "GET").toUpperCase();
      if (url === "/api/admin/tickets" && method === "GET") return resLike([ticketSummary]);
      if (url === "/api/admin/tickets/1/reply" && method === "POST")
        return resLike({
          id: 1,
          author_type: "admin",
          message: "تم حل المشكلة",
          created_at: "2026-09-01T10:00:00.000Z",
        });
      if (url === "/api/admin/tickets/1" && method === "GET") {
        detailCallCount += 1;
        // OPEN succeeds; the post-reply REFRESH fails (500).
        if (detailCallCount === 1) return resLike(ticketDetail);
        return resLike({ error: "خطأ في الخادم" }, false, 500);
      }
      return resLike({});
    });

    renderPage();
    await openFirstTicket();

    fireEvent.change(screen.getByPlaceholderText("اكتب ردك هنا…"), {
      target: { value: "تم حل المشكلة" },
    });
    fireEvent.click(screen.getByRole("button", { name: "إرسال الرد" }));

    // Give the async reply POST + silent refresh a moment to settle.
    // The reply committed (POST succeeded) and the refresh failure was
    // swallowed silently — so NO toast fires (handleReply has no success
    // toast by design; the draft clearing + thread refresh is the
    // feedback). Before the fix, the refresh's 500 surfaced as a
    // destructive «خطأ» toast AFTER the draft was already cleared.
    await new Promise((r) => setTimeout(r, 300));
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("handleStatus: a refresh failure after a successful status flip still toasts success (not «خطأ»)", async () => {
    // The OPEN detail fetch succeeds; the post-status REFRESH fails (500).
    let detailCallCount = 0;
    fetchMock.mockImplementation(async (input: unknown, init?: RequestInit) => {
      const url = String(input).split("?")[0];
      const method = (init?.method ?? "GET").toUpperCase();
      if (url === "/api/admin/tickets" && method === "GET") return resLike([ticketSummary]);
      if (url === "/api/admin/tickets/1/status" && method === "PATCH") return resLike({ ok: true });
      if (url === "/api/admin/tickets/1" && method === "GET") {
        detailCallCount += 1;
        if (detailCallCount === 1) return resLike(ticketDetail);
        return resLike({ error: "خطأ في الخادم" }, false, 500);
      }
      return resLike({});
    });

    renderPage();
    await openFirstTicket();

    // The "إغلاق" status button — selected by its visible text (the
    // close-details icon button uses aria-label «إغلاق تفاصيل التذكرة»
    // and has no visible "إغلاق" text node, so text selection is unique).
    const statusBtn = screen.getByText("إغلاق").closest("button")!;
    fireEvent.click(statusBtn);

    await waitFor(() => expect(toastMock).toHaveBeenCalledTimes(1));
    const toastArg = toastMock.mock.calls[0][0];
    // The PATCH succeeded — success toast, NOT the refresh's 500.
    expect(toastArg.variant).toBe("success");
    expect(String(toastArg.title)).toMatch(/تم إغلاق|إعادة فتح/);
  });
});
