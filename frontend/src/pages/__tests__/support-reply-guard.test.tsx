/**
 * Enter-key double-submit guard for the support reply form (R94-A1 #3).
 *
 * The reply input's onKeyDown calls `handleReply` DIRECTLY (so Enter
 * submits without Shift). The submit BUTTON is disabled while
 * `sending` is true, but the Enter path never goes through the button —
 * two quick Enters while the first POST /reply was still in flight
 * duplicated the reply in the ticket AND double-hit the server.
 *
 * The fix: `if (sending) return;` as the first statement of
 * handleReply (and handleCreate, for the same form-submit bypass).
 *
 * This test pins the contract with a CONTROLLABLE pending POST: the
 * reply fetch stays unresolved until the test settles it, so the
 * second Enter provably lands while the first is still in flight.
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

/** The reply POST — settles ONLY when the test says so. */
let settleReply!: (res: Response) => void;

function renderPage() {
  return render(
    <Router>
      <SupportPage />
    </Router>,
  );
}

describe("SupportPage — Enter double-submit guard (R94-A1 #3)", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    toastSpy.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    Element.prototype.scrollIntoView = vi.fn();
    const replyPending = new Promise<Response>((resolve) => {
      settleReply = resolve;
    });
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST" && url.includes("/reply")) {
        return replyPending;
      }
      if (url === "/api/support/tickets") {
        return Promise.resolve(resLike({ body: TICKET_LIST }));
      }
      if (url.includes("/api/support/tickets/1")) {
        return Promise.resolve(resLike({ body: TICKET_DETAIL }));
      }
      return Promise.resolve(resLike({ body: [] }));
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("two Enters while the reply POST is in flight produce ONE request", async () => {
    renderPage();

    const row = await screen.findByText("مشكلة في الطلب");
    fireEvent.click(row);

    const input = await screen.findByLabelText("نص الرد على التذكرة");
    fireEvent.change(input, { target: { value: "رد اختبار" } });

    // The double Enter — the exact bug scenario (second lands while the
    // first POST is still pending).
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Enter" });

    const replyCalls = fetchMock.mock.calls.filter(
      ([url, init]) => String(url).includes("/reply") && init?.method === "POST",
    );
    expect(replyCalls).toHaveLength(1);

    // While in flight: the send button is disabled and the spinner state
    // is visible (aria-label is stable — the icon-only button keeps it).
    expect(screen.getByRole("button", { name: "إرسال الرد" })).toBeDisabled();

    // Settle the pending POST — the happy path continues normally:
    // reply input clears, the thread refetches, no error toast.
    settleReply(resLike({ body: { success: true } }));
    await waitFor(() => {
      expect((screen.getByLabelText("نص الرد على التذكرة") as HTMLInputElement).value).toBe("");
    });
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it("Shift+Enter still does NOT submit (multi-line intent preserved)", async () => {
    renderPage();

    const row = await screen.findByText("مشكلة في الطلب");
    fireEvent.click(row);

    const input = await screen.findByLabelText("نص الرد على التذكرة");
    fireEvent.change(input, { target: { value: "رد اختبار" } });

    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });

    const replyCalls = fetchMock.mock.calls.filter(
      ([url, init]) => String(url).includes("/reply") && init?.method === "POST",
    );
    expect(replyCalls).toHaveLength(0);
    expect((screen.getByLabelText("نص الرد على التذكرة") as HTMLInputElement).value).toBe(
      "رد اختبار",
    );
  });
});
