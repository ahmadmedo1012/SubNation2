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
 * `fetch` is stubbed per-test with REAL Response objects (L6-1/R143:
 * the page rides the generated orval client, whose customFetch reads
 * .headers + .text() — the old ok/json-only stubs lacked both);
 * `@/lib/auth` and `@/hooks/useToast` are mocked at the
 * module boundary.
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Router } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SupportPage from "@/pages/support";

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

const toastSpy = vi.fn();
vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({ toast: toastSpy }),
}));

/** Real Response objects — customFetch (behind the generated client)
 * reads .headers + .text(), which the old ok/json-only stubs lacked
 * (L6-1/R143). */
function resLike(over: { ok?: boolean; status?: number; body?: unknown } = {}) {
  const { ok = true, status = ok ? 200 : 500, body = {} } = over;
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
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

// ── L6-1 (R143): non-JSON failure bodies never leak English ────────────────
// The two WRITERS rode a raw fetch with an UNGUARDED r.json() — a proxy
// 502 answering HTML threw SyntaxError("Unexpected token '<'…") BEFORE
// the !res.ok check, and the catch rendered err.message: English stack
// text inside the Arabic-only destructive toast. The generated client
// (customFetch + getErrorMessage's 96-F7 leak guard) collapses every
// non-Arabic body to the Arabic network fallback.
describe("SupportPage — a proxy 502 answering HTML never leaks English into the Arabic toast (L6-1)", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    toastSpy.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function html502() {
    return new Response("<html><body><h1>502 Bad Gateway</h1></body></html>", {
      status: 502,
      headers: { "content-type": "text/html" },
    });
  }

  it("handleCreate: the create POST's 502 HTML body surfaces the Arabic network fallback and the submit state clears", async () => {
    fetchMock.mockResolvedValueOnce(resLike({ body: TICKET_LIST })).mockImplementationOnce(html502);

    renderPage();
    fireEvent.click(await screen.findByText("تذكرة جديدة"));
    fireEvent.change(await screen.findByLabelText("عنوان المشكلة *"), {
      target: { value: "عنوان تجريبي" },
    });
    fireEvent.change(await screen.findByLabelText("تفاصيل المشكلة *"), {
      target: { value: "نص تجريبي" },
    });
    fireEvent.click(screen.getByRole("button", { name: "إرسال التذكرة" }));

    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: "خطأ", variant: "destructive" }),
      );
    });
    // Arabic-only copy: no English SyntaxError text, no HTML fragment,
    // no status-line leak.
    const description = String(toastSpy.mock.calls.at(-1)?.[0]?.description ?? "");
    expect(description).toContain("تعذّر");
    expect(description).not.toMatch(/[A-Za-z<]/);
    // The in-flight state cleared — the button re-enables (the old raw
    // fetch could hang the spinner for the browser's ~300 s TCP budget).
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "إرسال التذكرة" })).toBeEnabled(),
    );
  });

  it("handleReply: the reply POST's 502 HTML body surfaces the Arabic network fallback and the draft survives", async () => {
    fetchMock
      .mockResolvedValueOnce(resLike({ body: TICKET_LIST }))
      .mockResolvedValueOnce(resLike({ body: TICKET_DETAIL }))
      .mockImplementationOnce(html502);

    renderPage();
    fireEvent.click(await screen.findByText("مشكلة في الطلب"));
    const input = await screen.findByLabelText("نص الرد على التذكرة");
    fireEvent.change(input, { target: { value: "رد تجريبي" } });
    fireEvent.click(screen.getByRole("button", { name: "إرسال الرد" }));

    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: "خطأ", variant: "destructive" }),
      );
    });
    const description = String(toastSpy.mock.calls.at(-1)?.[0]?.description ?? "");
    expect(description).toContain("تعذّر");
    expect(description).not.toMatch(/[A-Za-z<]/);
    // The draft SURVIVES the failed send — the retry affordance stays
    // armed with the user's words.
    expect((screen.getByLabelText("نص الرد على التذكرة") as HTMLInputElement).value).toBe(
      "رد تجريبي",
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "إرسال الرد" })).toBeEnabled());
  });
});

// ── B-F2 (R186): openTicket's request-identity guard ───────────────────────
// Two clicks, the SLOW first response settling after the fast second one:
// the stale thread used to silently overwrite the last-clicked ticket's
// view. The monotonic seq (B-F2) drops every post-await write from the
// older call — the LAST-CLICKED ticket's thread is the one that stays.
describe("SupportPage — a stale slow openTicket response never overwrites the newer thread (B-F2)", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    toastSpy.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const LIST = [
    {
      id: 1,
      title: "مشكلة في الطلب",
      category: "order",
      status: "open",
      created_at: new Date(Date.now() - 3600_000).toISOString(),
      last_reply: null,
    },
    {
      id: 2,
      title: "استفسار عن الدفع",
      category: "payment",
      status: "open",
      created_at: new Date(Date.now() - 2400_000).toISOString(),
      last_reply: null,
    },
  ];

  const detail = (id: number, title: string) => ({
    id,
    title,
    category: "order",
    status: "open",
    created_at: new Date(Date.now() - 3600_000).toISOString(),
    last_reply: null,
    replies: [
      {
        id: 11,
        author_type: "user",
        message: `رد تذكرة ${id}`,
        created_at: new Date().toISOString(),
      },
    ],
  });

  it("the LAST-CLICKED ticket's thread renders after both detail fetches settle (reverse resolution order)", async () => {
    // Deferred detail responses the test resolves in REVERSE click order:
    // click ticket 1 (slow) → click ticket 2 (fast) → B settles → A settles.
    let resolveA!: (r: Response) => void;
    let resolveB!: (r: Response) => void;
    const detailA = new Promise<Response>((res) => {
      resolveA = res;
    });
    const detailB = new Promise<Response>((res) => {
      resolveB = res;
    });
    fetchMock
      .mockResolvedValueOnce(resLike({ body: LIST }))
      .mockImplementationOnce(() => detailA) // click #1 → ticket 1 (slow)
      .mockImplementationOnce(() => detailB); // click #2 → ticket 2 (fast)

    renderPage();
    fireEvent.click(await screen.findByText("مشكلة في الطلب"));
    // The list stays rendered while both fetches are in flight — the
    // second row is clickable.
    fireEvent.click(screen.getByText("استفسار عن الدفع"));

    // The fast (last-clicked) response lands first.
    await act(async () => {
      resolveB(resLike({ body: detail(2, "استفسار عن الدفع") }));
      await detailB;
    });
    expect(await screen.findByText("رد تذكرة 2")).toBeInTheDocument();

    // …then the SLOW first-click response settles — it must be DROPPED.
    await act(async () => {
      resolveA(resLike({ body: detail(1, "مشكلة في الطلب") }));
      await detailA;
    });
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("استفسار عن الدفع");
    });
    // The stale thread's message and title never rendered (the list view
    // is hidden while a thread is open, so a leaked stale write would show
    // BOTH the wrong h1 and the wrong reply).
    expect(screen.queryByText("رد تذكرة 1")).not.toBeInTheDocument();
    expect(screen.queryByText("مشكلة في الطلب")).not.toBeInTheDocument();
  });
});
