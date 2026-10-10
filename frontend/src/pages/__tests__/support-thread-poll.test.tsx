/**
 * B-10 (R128-IMP-5 / B13 §3) — the support thread poll.
 *
 * User-side ticket threads have no socket event today (admin replies
 * reach the user through the notification bell), so while an OPEN /
 * IN_PROGRESS ticket is selected the page re-fetches its thread every
 * 25 s — the storefront's last fetch-once surface that stayed stale
 * while the user waited for a reply.
 *
 * Pinned here (fake-timer discipline per flash-sale-banner.test.tsx —
 * raw fetch stubbed per-test like every support suite):
 *   • an open ticket selected → one silent thread refetch per 25 s;
 *   • the refresh is SILENT: a typed reply draft survives the tick
 *     (openTicket would have cleared it) and a landed admin reply
 *     renders without any toast;
 *   • a hidden tab never polls (the document.hidden gate — the same
 *     contract refetchIntervalInBackground:false gives query pages);
 *   • a CLOSED ticket never arms the poll;
 *   • a poll response that resolves after the user backed out to the
 *     list does not re-open the detail view (the functional set).
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
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

const ticketRow = (status: string) => ({
  id: 1,
  title: "مشكلة في الطلب",
  category: "order",
  status,
  created_at: new Date(Date.now() - 3600_000).toISOString(),
  last_reply: null,
});

function threadDetail(status: string, replies: Array<{ message: string }>) {
  return {
    ...ticketRow(status),
    replies: replies.map((r, i) => ({
      id: 11 + i,
      author_type: "admin",
      message: r.message,
      created_at: new Date(Date.now() - 1800_000).toISOString(),
    })),
  };
}

const fetchMock = vi.fn<typeof fetch>();

function renderPage() {
  return render(
    <Router>
      <SupportPage />
    </Router>,
  );
}

/** Resolve the pending raw-fetch promise chains with fake timers active
 * (the support page rides plain .then chains, not react-query). */
async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe("SupportPage — B-10 open-ticket thread poll (25 s, visible tabs only)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock.mockReset();
    toastSpy.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    // jsdom doesn't implement scrollIntoView — the thread auto-scroll
    // needs it as a no-op.
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("an open ticket selected → one silent thread refetch per 25 s (new admin reply lands)", async () => {
    fetchMock
      .mockResolvedValueOnce(resLike({ body: [ticketRow("open")] }))
      .mockResolvedValueOnce(resLike({ body: threadDetail("open", [{ message: "الرد الأول" }]) }))
      // The 25 s tick returns the thread WITH the new admin reply.
      .mockResolvedValueOnce(
        resLike({
          body: threadDetail("open", [{ message: "الرد الأول" }, { message: "رد جديد من الدعم" }]),
        }),
      );

    renderPage();
    await flushMicrotasks();
    fireEvent.click(screen.getByText("مشكلة في الطلب"));
    await flushMicrotasks();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // One 25 s tick → exactly one silent refetch of the SAME thread.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(25_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/support/tickets/1",
      expect.objectContaining({ headers: { Authorization: "Bearer test-token" } }),
    );

    // The new reply rendered — the poll is the freshness mechanism.
    expect(screen.getByText("رد جديد من الدعم")).toBeInTheDocument();
    // …and it was SILENT: no error toast, no skeleton path.
    expect(toastSpy).not.toHaveBeenCalled();

    // A second tick refetches again (the cadence, not a one-shot).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(25_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("the tick never clears the reply draft (it must not ride openTicket)", async () => {
    fetchMock
      .mockResolvedValueOnce(resLike({ body: [ticketRow("open")] }))
      .mockResolvedValueOnce(resLike({ body: threadDetail("open", [{ message: "الرد الأول" }]) }))
      .mockResolvedValueOnce(resLike({ body: threadDetail("open", [{ message: "الرد الأول" }]) }));

    renderPage();
    await flushMicrotasks();
    fireEvent.click(screen.getByText("مشكلة في الطلب"));
    await flushMicrotasks();

    // The user typed a reply draft…
    const input = screen.getByLabelText("نص الرد على التذكرة");
    fireEvent.change(input, { target: { value: "ردّي قيد الصياغة" } });
    // …a poll tick lands mid-composition…
    await act(async () => {
      await vi.advanceTimersByTimeAsync(25_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // …the draft survives (openTicket's setReplyText("") must not run).
    expect(input).toHaveValue("ردّي قيد الصياغة");
  });

  it("a hidden tab never polls (the document.hidden gate)", async () => {
    fetchMock
      .mockResolvedValueOnce(resLike({ body: [ticketRow("open")] }))
      .mockResolvedValueOnce(resLike({ body: threadDetail("open", [{ message: "الرد الأول" }]) }));

    renderPage();
    await flushMicrotasks();
    fireEvent.click(screen.getByText("مشكلة في الطلب"));
    await flushMicrotasks();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Background the tab and let two full cadences pass.
    await act(async () => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => true,
      });
      await vi.advanceTimersByTimeAsync(50_000);
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => false,
      });
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("a closed ticket never arms the poll (open/awaiting tickets only)", async () => {
    fetchMock
      .mockResolvedValueOnce(resLike({ body: [ticketRow("closed")] }))
      .mockResolvedValueOnce(resLike({ body: threadDetail("closed", []) }));

    renderPage();
    await flushMicrotasks();
    fireEvent.click(screen.getByText("مشكلة في الطلب"));
    await flushMicrotasks();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(80_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("a late poll response never re-opens the thread after the user backed out to the list", async () => {
    // The tick's fetch is held pending; the user backs out before it
    // resolves — the functional set must drop the stale detail.
    let resolveTick!: (v: ReturnType<typeof resLike>) => void;
    fetchMock
      .mockResolvedValueOnce(resLike({ body: [ticketRow("open")] }))
      .mockResolvedValueOnce(resLike({ body: threadDetail("open", [{ message: "الرد الأول" }]) }))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveTick = resolve as typeof resolveTick;
          }),
      );

    renderPage();
    await flushMicrotasks();
    fireEvent.click(screen.getByText("مشكلة في الطلب"));
    await flushMicrotasks();

    // Fire the tick (fetch pending)…
    await act(async () => {
      await vi.advanceTimersByTimeAsync(25_000);
    });
    // …back out to the list while it is in flight…
    fireEvent.click(screen.getByRole("button", { name: "رجوع لقائمة التذاكر" }));
    expect(screen.getByText("مشكلة في الطلب")).toBeInTheDocument();

    // …then let the response land: the list must stay.
    await act(async () => {
      resolveTick(resLike({ body: threadDetail("open", [{ message: "الرد الأول" }]) }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText("مشكلة في الطلب")).toBeInTheDocument();
    expect(screen.queryByText("الرد الأول")).not.toBeInTheDocument();
  });
});
